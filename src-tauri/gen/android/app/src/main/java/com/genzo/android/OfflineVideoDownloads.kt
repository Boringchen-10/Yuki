package com.genzo.android

import android.content.Context
import android.net.Uri
import android.os.Looper
import android.os.Handler
import android.os.SystemClock
import android.util.Base64
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist
import androidx.media3.exoplayer.offline.DefaultDownloadIndex
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadProgress
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.offline.DownloaderFactory
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.common.util.UriUtil
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal class OfflineDownloadException(val reason: String) : IOException(reason)
internal data class OfflineVideoPreparation(val request: DownloadRequest, val secret: String?, val previousUri: Uri?)

/** Media3 owns the durable queue and cache. Credentials and source URLs stay encrypted. */
internal class OfflineVideoDownloads private constructor(private val context: Context) {
    private val credentials = CredentialStore(context)
    private val database = StandaloneDatabaseProvider(context)
    private val caches = HashMap<String, SimpleCache>()
    private val bridges = HashMap<String, OfflineVideoBridge>()
    private fun storageId(request: DownloadRequest): String = JSONObject(String(request.data, Charsets.UTF_8)).optString("storageId", "internal")
    @Synchronized private fun cache(id: String): SimpleCache {
        val root = if (id == "internal") context.filesDir else DownloadStorage.root(context, id, true)
        return caches.getOrPut(id) { SimpleCache(File(root, "offline-video-cache"), NoOpCacheEvictor(), database) }
    }
    @Synchronized private fun bridge(id: String): OfflineVideoBridge = bridges.getOrPut(id) { OfflineVideoBridge(cache(id)) }
    @Synchronized private fun revokeReaders() { bridges.values.forEach { it.revokePrevious() } }
    private val index = DefaultDownloadIndex(database, "GenzoOfflineVideos").apply {
        // Restoring the app never restarts network work until the user explicitly continues it.
        getDownloads(Download.STATE_QUEUED, Download.STATE_DOWNLOADING).use { cursor ->
            while (cursor.moveToNext()) {
                val previous = cursor.download
                putDownload(Download(previous.request, Download.STATE_STOPPED, previous.startTimeMs, System.currentTimeMillis(),
                    previous.contentLength, 2, Download.FAILURE_REASON_NONE,
                    DownloadProgress().apply { bytesDownloaded = previous.bytesDownloaded; percentDownloaded = previous.percentDownloaded }))
            }
        }
    }
    private val errors = context.getSharedPreferences("genzo-offline-video-errors", 0)
    private class Pending(val expiresAt: Long, var preparation: OfflineVideoPreparation? = null)
    private val pending = ConcurrentHashMap<String, Pending>()
    val manager = DownloadManager(context, index, DownloaderFactory { request ->
        val secret = lazy { readSecret(request.id) }
        val source = DataSource.Factory { OfflineNetworkDataSource { secret.value } }
        DefaultDownloaderFactory(CacheDataSource.Factory().setCache(cache(storageId(request))).setUpstreamDataSourceFactory(source), Executor { it.run() })
            .createDownloader(request)
    }).apply {
        maxParallelDownloads = 2
        minRetryCount = 2
        requirements = Requirements(Requirements.NETWORK)
        addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(manager: DownloadManager, download: Download, finalException: Exception?) {
                if (download.state == Download.STATE_FAILED) {
                    var cause: Throwable? = finalException
                    var reason = "offline_download_failed"
                    repeat(8) { if (cause is OfflineDownloadException) reason = (cause as OfflineDownloadException).reason; cause = cause?.cause }
                    errors.edit().putString(download.request.id, reason).apply()
                } else if (download.state != Download.STATE_STOPPED) errors.edit().remove(download.request.id).apply()
            }
            override fun onDownloadRemoved(manager: DownloadManager, download: Download) {
                credentials.delete(secretId(download.request.id)); errors.edit().remove(download.request.id).apply()
                synchronized(this@OfflineVideoDownloads) { bridges[storageId(download.request)]?.remove(download.request.id) }
            }
        })
    }

    fun prepare(id: String, uri: String, headers: Map<String, String>, title: String,
        mediaFileId: String?, workId: String?, episodeTitle: String?, recipe: JSONObject, forceRefresh: Boolean = false): OfflineVideoPreparation {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,96}")))
        val existing = index.getDownload(id)
        if (existing != null) {
            if (existing.state == Download.STATE_COMPLETED || (!forceRefresh && existing.state != Download.STATE_FAILED))
                return OfflineVideoPreparation(existing.request, null, existing.request.uri)
            if (existing.state !in listOf(Download.STATE_FAILED, Download.STATE_STOPPED)) throw OfflineDownloadException("offline_download_active")
        }
        require(recipe.toString().length <= 12000 && recipe.keys().asSequence().all { it in listOf("pluginId", "source", "roadIndex", "episodeIndex", "mediaFileId", "workId", "expectedEpisodeKey") })
        checkedHttpUri(uri)
        require(title.length <= 1000 && headers.size <= 32)
        headers.forEach { (key, value) ->
            require(key.matches(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}")) && value.length <= 8192 && !value.contains('\r') && !value.contains('\n'))
            require(key.lowercase() !in listOf("host", "connection", "range", "accept-encoding", "content-length"))
        }
        val location = existing?.request?.let(::storageId) ?: DownloadStorage.selectedId(context)
        DownloadStorage.root(context, location, true)
        val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val secret = OfflineVideoSecret(id, uri, headers, key)
        val deadline = SystemClock.elapsedRealtime() + 45000
        val source = secret.probeHttpFactory(45000).createDataSource()
        val first = ByteArrayOutputStream()
        var mime = ""
        try {
            openOfflineHttp(source, DataSpec.Builder().setUri(uri).setLength(512).build())
            mime = source.responseHeaders.entries.firstOrNull { it.key.equals("content-type", true) }?.value?.firstOrNull().orEmpty()
            val buffer = ByteArray(512)
            while (first.size() < 512) {
                val count = source.read(buffer, 0, 512 - first.size())
                if (count == C.RESULT_END_OF_INPUT) break
                first.write(buffer, 0, count)
            }
        } finally { source.close() }
        val prefix = first.toByteArray().toString(Charsets.UTF_8).trimStart('\uFEFF', ' ', '\r', '\n', '\t')
        if (first.size() == 0) throw OfflineDownloadException("offline_not_video")
        val hls = prefix.startsWith("#EXTM3U")
        if (mime.contains("dash", true) || prefix.startsWith("<MPD") || prefix.contains("<MPD")) throw OfflineDownloadException("offline_unsupported_format")
        if (!hls && (mime.startsWith("text/", true) || mime.contains("json", true) || mime.contains("xml", true) || prefix.startsWith("<!DOCTYPE", true) || prefix.startsWith("<html", true))) throw OfflineDownloadException("offline_not_video")
        var resolution: String? = null
        if (hls) {
            val manifest = secret.probeHttpFactory((deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1)).createDataSource()
            try {
                openOfflineHttp(manifest, DataSpec.Builder().setUri(uri).build())
                val bytes = readBounded(manifest, 8 * 1024 * 1024)
                val parsed = HlsPlaylistParser().parse(manifest.uri ?: Uri.parse(uri), ByteArrayInputStream(bytes))
                validateOfflineHls(parsed, String(bytes, Charsets.UTF_8))
                resolution = if (parsed is HlsMultivariantPlaylist) selectOfflineHls(parsed).resolution else "来源画质"
            } finally { manifest.close() }
        }
        val data = JSONObject().put("title", title).put("mediaFileId", mediaFileId).put("workId", workId).put("episodeTitle", episodeTitle)
            .put("recipe", recipe).put("resolution", resolution).put("storageId", location)
        val root = secret.encode(uri, hls)
        val stored = JSONObject().put("uri", uri).put("headers", JSONObject(headers)).put("key", Base64.encodeToString(key, Base64.NO_WRAP))
        if (JSONObject().put("username", "offline-video").put("password", stored.toString()).toString().toByteArray(Charsets.UTF_8).size > 16384)
            throw OfflineDownloadException("offline_credentials_too_large")
        val request = DownloadRequest.Builder(id, root).setMimeType(if (hls) MimeTypes.APPLICATION_M3U8 else MimeTypes.VIDEO_MP4)
            .setData(data.toString().toByteArray(Charsets.UTF_8)).build()
        return OfflineVideoPreparation(request, stored.toString(), existing?.request?.uri)
    }
    fun stage(create: () -> OfflineVideoPreparation): String {
        val ticket = UUID.randomUUID().toString()
        synchronized(pending) {
            if (pending.size >= 2) throw OfflineDownloadException("offline_prepare_busy")
            pending[ticket] = Pending(SystemClock.elapsedRealtime() + 120000)
        }
        Handler(Looper.getMainLooper()).postDelayed({ pending.remove(ticket) }, 120000)
        try {
            val prepared = create()
            synchronized(pending) {
                val slot = pending[ticket] ?: throw OfflineDownloadException("offline_prepare_expired")
                if (slot.expiresAt <= SystemClock.elapsedRealtime()) throw OfflineDownloadException("offline_prepare_expired")
                slot.preparation = prepared
            }
            return ticket
        } catch (error: Exception) { pending.remove(ticket); throw error }
    }
    fun discard(ticket: String) { pending.remove(ticket) }
    fun commitTicket(ticket: String, id: String?): DownloadRequest {
        val slot = pending.remove(ticket) ?: throw OfflineDownloadException("offline_prepare_expired")
        if (slot.expiresAt <= SystemClock.elapsedRealtime()) throw OfflineDownloadException("offline_prepare_expired")
        val prepared = slot.preparation ?: throw OfflineDownloadException("offline_prepare_busy")
        if (id != null && id != prepared.request.id) throw OfflineDownloadException("offline_prepare_expired")
        return commit(prepared)
    }
    fun commit(prepared: OfflineVideoPreparation): DownloadRequest {
        val existing = index.getDownload(prepared.request.id)
        if (existing?.request?.uri != prepared.previousUri) throw OfflineDownloadException("offline_prepare_expired")
        if (prepared.secret == null) return existing?.request ?: throw OfflineDownloadException("offline_prepare_expired")
        if (existing?.state == Download.STATE_COMPLETED) return existing.request
        if (existing != null && existing.state !in listOf(Download.STATE_FAILED, Download.STATE_STOPPED)) throw OfflineDownloadException("offline_download_active")
        credentials.save(secretId(prepared.request.id), "offline-video", prepared.secret)
        // Explicit retry refreshes the signed address and its generated cache together.
        if (existing != null) cache(storageId(existing.request)).let { cache -> cache.keys.filter { it.startsWith("https://offline.genzo.invalid/${prepared.request.id}/") }.forEach { cache.removeResource(it) } }
        return prepared.request
    }

    fun add(request: DownloadRequest): String {
        if (index.getDownload(request.id)?.let { it.state == Download.STATE_COMPLETED && it.request.uri == request.uri } == true) return "completed"
        DownloadService.sendAddDownload(context, VideoDownloadService::class.java, request, true)
        DownloadService.sendResumeDownloads(context, VideoDownloadService::class.java, true)
        return "queued"
    }
    fun control(id: String, action: String) {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,96}")))
        when (action) {
            "pause" -> DownloadService.sendSetStopReason(context, VideoDownloadService::class.java, id, 1, false)
            "resume", "retry" -> {
                val request = index.getDownload(id)?.request ?: throw OfflineDownloadException("offline_download_missing")
                DownloadService.sendAddDownload(context, VideoDownloadService::class.java, request, true)
                DownloadService.sendSetStopReason(context, VideoDownloadService::class.java, id, Download.STOP_REASON_NONE, false)
                DownloadService.sendResumeDownloads(context, VideoDownloadService::class.java, true)
            }
            "remove" -> DownloadService.sendRemoveDownload(context, VideoDownloadService::class.java, id, false)
            else -> throw IllegalArgumentException("invalid_download_action")
        }
    }
    fun list(active: List<Download>): JSONArray {
        val downloads = linkedMapOf<String, Download>()
        index.getDownloads().use { cursor -> while (cursor.moveToNext()) downloads[cursor.download.request.id] = cursor.download }
        active.forEach { downloads[it.request.id] = it }
        return JSONArray().apply { downloads.values.sortedByDescending { it.startTimeMs }.forEach { put(dto(it)) } }
    }
    private fun dto(download: Download): JSONObject {
        val state = when (download.state) {
            Download.STATE_DOWNLOADING -> "downloading"
            Download.STATE_STOPPED -> if (download.stopReason == 2) "interrupted" else "paused"
            Download.STATE_COMPLETED -> "completed"
            Download.STATE_FAILED -> "failed"
            Download.STATE_REMOVING, Download.STATE_RESTARTING -> "removing"
            else -> "queued"
        }
        return JSONObject(String(download.request.data, Charsets.UTF_8)).put("id", download.request.id).put("kind", "video").put("state", state)
            .put("bytesDownloaded", download.bytesDownloaded).put("totalBytes", download.contentLength.takeIf { it >= 0 } ?: JSONObject.NULL)
            .put("percent", download.percentDownloaded.takeIf { it >= 0 } ?: JSONObject.NULL)
            .put("createdAt", offlineIsoTime(download.startTimeMs)).put("updatedAt", offlineIsoTime(download.updateTimeMs))
            .put("error", if (state == "failed") errors.getString(download.request.id, "offline_download_failed") else JSONObject.NULL)
    }
    fun locator(id: String): JSONObject {
        val download = index.getDownload(id) ?: throw OfflineDownloadException("offline_download_missing")
        if (download.state != Download.STATE_COMPLETED) throw OfflineDownloadException("offline_download_incomplete")
        val bridge = bridge(storageId(download.request)); revokeReaders()
        return JSONObject(String(download.request.data)).put("uri", bridge.locator(id, download.request.uri))
    }
    fun fileLocator(path: String): String {
        val file = File(path).canonicalFile
        val root = DownloadStorage.locations(context).map { File(it.root, "remote-cache").canonicalFile }.firstOrNull { file.parentFile == it }
            ?: throw OfflineDownloadException("offline_storage_unavailable")
        val bridge = bridge("internal"); revokeReaders()
        return bridge.fileLocator(root, path)
    }
    private fun readSecret(id: String): OfflineVideoSecret {
        val stored = JSONObject(credentials.read(secretId(id)).getString("password"))
        val headers = stored.getJSONObject("headers").let { json -> json.keys().asSequence().associateWith { json.getString(it) } }
        return OfflineVideoSecret(id, stored.getString("uri"), headers, Base64.decode(stored.getString("key"), Base64.NO_WRAP))
    }
    companion object {
        @Volatile private var current: OfflineVideoDownloads? = null
        fun get(context: Context): OfflineVideoDownloads {
            current?.let { return it }
            check(Looper.myLooper() == Looper.getMainLooper())
            return synchronized(this) { current ?: OfflineVideoDownloads(context.applicationContext).also { current = it } }
        }
        private fun secretId(id: String) = "offline-video:$id"
    }
}

internal fun checkedHttpUri(raw: String): Uri {
    val uri = Uri.parse(raw)
    require(raw.length <= 8192 && uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo.isNullOrEmpty())
    return uri
}

private val offlineTimeFormat = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
internal fun offlineIsoTime(milliseconds: Long): String = offlineTimeFormat.format(Instant.ofEpochMilli(milliseconds))
internal fun offlineErrorCode(error: Throwable, fallback: String): String {
    var current: Throwable? = error
    repeat(8) { if (current is OfflineDownloadException) return (current as OfflineDownloadException).reason; current = current?.cause }
    return fallback
}
internal fun validateOfflineContentRange(header: String?, position: Long, length: Long) {
    val match = Regex("bytes (\\d+)-(\\d+)/(\\d+|\\*)").matchEntire(header?.trim().orEmpty()) ?: throw OfflineDownloadException("offline_invalid_range")
    val start = match.groupValues[1].toLongOrNull() ?: throw OfflineDownloadException("offline_invalid_range")
    val end = match.groupValues[2].toLongOrNull() ?: throw OfflineDownloadException("offline_invalid_range")
    val total = match.groupValues[3].takeUnless { it == "*" }?.toLongOrNull()
    if (start != position || end < start || end == Long.MAX_VALUE || (match.groupValues[3] != "*" && (total == null || total <= end)) ||
        (length >= 0 && end - start + 1 > length)) throw OfflineDownloadException("offline_invalid_range")
}
private fun openOfflineHttp(source: OkHttpDataSource, spec: DataSpec): Long {
    val length = source.open(spec)
    if (source.responseCode == 206) validateOfflineContentRange(source.responseHeaders.entries.firstOrNull { it.key.equals("content-range", true) }?.value?.firstOrNull(), spec.position, spec.length)
    return length
}
private fun validateOfflineHls(parsed: HlsPlaylist, text: String) {
    if (text.contains("#EXT-X-DEFINE") || text.contains("#EXT-X-CONTENT-STEERING")) throw OfflineDownloadException("offline_unsupported_playlist")
    if (Regex("\\bMETHOD=([^,\\r\\n]+)").findAll(text).any { it.groupValues[1] !in listOf("NONE", "AES-128") }) throw OfflineDownloadException("offline_drm_unsupported")
    when (parsed) {
        is HlsMediaPlaylist -> {
            if (!parsed.hasEndTag) throw OfflineDownloadException("offline_live_unsupported")
            if (parsed.protectionSchemes != null || parsed.segments.any { it.drmInitData != null }) throw OfflineDownloadException("offline_drm_unsupported")
        }
        is HlsMultivariantPlaylist -> if (parsed.sessionKeyDrmInitData.isNotEmpty()) throw OfflineDownloadException("offline_drm_unsupported")
    }
}

internal class OfflineVideoSecret(val id: String, val uri: String, private val headers: Map<String, String>, private val key: ByteArray) {
    private val encoded = HashMap<String, Uri>()
    private val client by lazy { createHttpClient() }
    private val http by lazy { OkHttpDataSource.Factory(client).setDefaultRequestProperties(headers) }
    fun encode(raw: String, playlist: Boolean): Uri = synchronized(encoded) {
        encoded.getOrPut("$playlist:$raw") {
            checkedHttpUri(raw)
            // A keyed URI digest gives the same resource its cache identity after process death.
            val nonce = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
                .doFinal(("offline-uri\u0000" + raw).toByteArray(Charsets.UTF_8)).copyOf(12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce)); updateAAD(id.toByteArray(Charsets.UTF_8))
            }
            val token = Base64.encodeToString(cipher.iv + cipher.doFinal(raw.toByteArray(Charsets.UTF_8)), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            Uri.parse("https://offline.genzo.invalid/$id/$token.${if (playlist) "m3u8" else "bin"}")
        }
    }
    fun decode(uri: Uri): Uri {
        require(uri.host == "offline.genzo.invalid" && uri.pathSegments.size == 2 && uri.pathSegments[0] == id)
        val token = uri.lastPathSegment!!.substringBeforeLast('.')
        val bytes = Base64.decode(token, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        require(bytes.size in 29..16384)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            updateAAD(id.toByteArray(Charsets.UTF_8))
        }
        return checkedHttpUri(String(cipher.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8))
    }
    fun httpFactory(): OkHttpDataSource.Factory = http
    fun probeHttpFactory(timeoutMs: Long): OkHttpDataSource.Factory = OkHttpDataSource.Factory(client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()).setDefaultRequestProperties(headers)
    private fun createHttpClient(): OkHttpClient {
        val origin = checkedHttpUri(uri)
        return OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
            .addNetworkInterceptor { chain ->
                val request = chain.request()
                val port = if (origin.port > 0) origin.port else if (origin.scheme == "https") 443 else 80
                val sameOrigin = request.url.host.equals(origin.host, true) && request.url.scheme == origin.scheme && request.url.port == port
                val safe = request.newBuilder()
                if (!sameOrigin) headers.keys.filterNot { it.lowercase() in listOf("user-agent", "referer", "accept", "accept-language") }.forEach { safe.removeHeader(it) }
                val response = chain.proceed(safe.build())
                if (response.code >= 400) { response.close(); throw OfflineDownloadException("offline_download_connection_failed") }
                response
            }.build()
    }
}

/** HTTP transport remains Media3/OkHttp; only manifests are validated and redirected to opaque cache identities. */
private class OfflineNetworkDataSource(private val secretProvider: () -> OfflineVideoSecret) : BaseDataSource(true) {
    private var upstream: DataSource? = null
    private var opened: DataSpec? = null
    private var buffered: ByteArrayInputStream? = null
    override fun open(dataSpec: DataSpec): Long {
        try { return openChecked(dataSpec) }
        catch (error: Exception) {
            runCatching { close() }
            throw if (error is OfflineDownloadException) error else OfflineDownloadException("offline_download_connection_failed")
        }
    }
    private fun openChecked(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        val secret = try { secretProvider() } catch (_: Exception) { throw OfflineDownloadException("offline_credentials_unavailable") }
        val network = secret.httpFactory().createDataSource().also { upstream = it }
        val actual = secret.decode(dataSpec.uri)
        val expectedPlaylist = dataSpec.uri.lastPathSegment?.endsWith(".m3u8") == true
        val upstreamSpec = dataSpec.buildUpon().setUri(actual).apply { if (expectedPlaylist) { setPosition(0); setLength(C.LENGTH_UNSET.toLong()) } }.build()
        val length = openOfflineHttp(network, upstreamSpec)
        opened = dataSpec
        transferStarted(dataSpec)
        val mime = network.responseHeaders.entries.firstOrNull { it.key.equals("content-type", true) }?.value?.firstOrNull().orEmpty()
        val playlist = expectedPlaylist || mime.contains("mpegurl", true)
        val result = if (playlist) {
            val bytes = readBounded(network, 8 * 1024 * 1024)
            val base = network.uri ?: actual
            val text = String(bytes, Charsets.UTF_8)
            val parsed = HlsPlaylistParser().parse(base, ByteArrayInputStream(bytes))
            validateOfflineHls(parsed, text)
            val selection = (parsed as? HlsMultivariantPlaylist)?.let { selectOfflineHls(it) }
            val playlists = selection?.uris.orEmpty()
            val filtered = if (selection != null) filterOfflineHlsMaster(text, base, playlists) else text
            val rewritten = rewriteOfflinePlaylist(filtered) { raw ->
                val resolved = UriUtil.resolveToUri(base.toString(), raw)
                if (resolved.scheme == "data") raw else secret.encode(resolved.toString(), resolved in playlists).toString()
            }.toByteArray(Charsets.UTF_8)
            if (dataSpec.position > rewritten.size) throw OfflineDownloadException("offline_invalid_playlist")
            val available = rewritten.size - dataSpec.position.toInt()
            val count = if (dataSpec.length == C.LENGTH_UNSET.toLong()) available else minOf(available.toLong(), dataSpec.length).toInt()
            network.close(); buffered = ByteArrayInputStream(rewritten, dataSpec.position.toInt(), count)
            count.toLong()
        } else length
        return result
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        val count = try { buffered?.read(buffer, offset, length) ?: requireNotNull(upstream).read(buffer, offset, length) }
            catch (_: Exception) { throw OfflineDownloadException("offline_download_connection_failed") }
        if (count > 0) bytesTransferred(count)
        return count
    }
    override fun getUri(): Uri? = opened?.uri
    override fun getResponseHeaders(): Map<String, List<String>> = emptyMap()
    override fun close() {
        try { upstream?.close() } catch (_: Exception) { throw OfflineDownloadException("offline_download_connection_failed") } finally {
            buffered = null; upstream = null
            if (opened != null) { opened = null; transferEnded() }
        }
    }
}

internal data class OfflineHlsSelection(val uris: Set<Uri>, val resolution: String)
internal fun selectOfflineHls(master: HlsMultivariantPlaylist): OfflineHlsSelection {
    val variants = master.variants.filter { it.format.roleFlags and C.ROLE_FLAG_TRICK_PLAY == 0 }
    if (variants.isEmpty()) throw OfflineDownloadException("offline_invalid_playlist")
    val under1080 = variants.filter { it.format.height in 1..1080 }
    val video = if (under1080.isNotEmpty()) under1080.maxWith(compareBy({ it.format.height }, { it.format.bitrate }))
        else variants.minWith(compareBy({ if (it.format.height > 0) it.format.height else Int.MAX_VALUE }, { it.format.bitrate }))
    val audio = master.audios.filter { it.groupId == video.audioGroupId }.let { tracks -> tracks.firstOrNull { it.format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0 } ?: tracks.firstOrNull() }
    val subtitle = master.subtitles.firstOrNull { it.groupId == video.subtitleGroupId && it.format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0 }
    return OfflineHlsSelection(listOfNotNull(video.url, audio?.url, subtitle?.url).toSet(),
        if (video.format.width > 0 && video.format.height > 0) "${video.format.width}×${video.format.height}" else "来源画质")
}

private fun filterOfflineHlsMaster(text: String, base: Uri, selected: Set<Uri>): String {
    val output = mutableListOf<String>()
    var variant: String? = null
    val attribute = Regex("URI=\"([^\"]+)\"")
    for (line in text.lineSequence()) {
        val trimmed = line.trim()
        when {
            trimmed.startsWith("#EXT-X-STREAM-INF:") -> variant = line
            trimmed.isNotEmpty() && !trimmed.startsWith('#') && variant != null -> {
                if (UriUtil.resolveToUri(base.toString(), trimmed) in selected) { output.add(requireNotNull(variant)); output.add(line) }
                variant = null
            }
            trimmed.startsWith("#EXT-X-I-FRAME-STREAM-INF:") || trimmed.startsWith("#EXT-X-MEDIA:") -> {
                val uri = attribute.find(line)?.groupValues?.get(1)
                if (uri == null || UriUtil.resolveToUri(base.toString(), uri) in selected) output.add(line)
            }
            else -> output.add(line)
        }
    }
    return output.joinToString("\n")
}

internal fun readBounded(source: DataSource, maximum: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16384)
    while (true) {
        val count = source.read(buffer, 0, buffer.size)
        if (count == C.RESULT_END_OF_INPUT) break
        if (output.size() + count > maximum) throw OfflineDownloadException("offline_playlist_too_large")
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

// HLS syntax and stream identities come from Media3. This pass only changes URI references.
internal fun rewriteOfflinePlaylist(text: String, map: (String) -> String): String {
    val attribute = Regex("URI=\"([^\"]+)\"")
    return text.lineSequence().joinToString("\n") { line ->
        val trimmed = line.trim()
        if (trimmed.isNotEmpty() && !trimmed.startsWith('#')) map(trimmed)
        else attribute.replace(line) { match -> "URI=\"${map(match.groupValues[1])}\"" }
    }
}
