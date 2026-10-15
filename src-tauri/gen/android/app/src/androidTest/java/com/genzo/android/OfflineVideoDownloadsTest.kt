package com.genzo.android

import android.content.Context
import android.net.Uri
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.ContentMetadataMutations
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.media3.exoplayer.offline.Download
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

@RunWith(AndroidJUnit4::class)
class OfflineVideoDownloadsTest {
    @Test fun opaqueResourcesRestoreTheirIdentityWithoutExposingSignedUrls() {
        val key = ByteArray(32) { (it + 1).toByte() }
        val uri = "https://media.example/episode.m3u8?token=private-signed-value"
        val first = OfflineVideoSecret("test", uri, emptyMap(), key).encode(uri, true)
        val restored = OfflineVideoSecret("test", uri, emptyMap(), key)
        assertEquals(first, restored.encode(uri, true)); assertEquals(uri, restored.decode(first).toString())
        assertFalse(first.toString().contains("private-signed-value")); assertFalse(first.toString().contains("media.example"))
        try { OfflineVideoSecret("other", uri, emptyMap(), key).decode(first); fail("another task must not decode this capability") } catch (_: Exception) { }
    }

    @Test fun selectsOne1080VariantAndOnlyItsDefaultAudioGroup() {
        val manifest = """
            #EXTM3U
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="small",NAME="small",URI="small-audio.m3u8"
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="large",NAME="default",DEFAULT=YES,URI="large-audio.m3u8"
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="large",NAME="alternate",URI="alternate-audio.m3u8"
            #EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,AUDIO="small"
            720.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,AUDIO="large"
            1080.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160,AUDIO="large"
            2160.m3u8
        """.trimIndent()
        val master = HlsPlaylistParser().parse(Uri.parse("https://media.example/master.m3u8"), ByteArrayInputStream(manifest.toByteArray())) as HlsMultivariantPlaylist
        val selection = selectOfflineHls(master)
        assertEquals("1920×1080", selection.resolution)
        assertEquals(setOf("https://media.example/1080.m3u8", "https://media.example/large-audio.m3u8"), selection.uris.map { it.toString() }.toSet())
    }

    @Test fun allLargeVariantsUseTheLowestResolution() {
        val text = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160\n4k.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=2560x1440\n2k.m3u8\n"
        val master = HlsPlaylistParser().parse(Uri.parse("https://media.example/master.m3u8"), ByteArrayInputStream(text.toByteArray())) as HlsMultivariantPlaylist
        assertEquals("2560×1440", selectOfflineHls(master).resolution)
    }

    @Test fun offlineBridgeServesExactRangesAndRejectsMissingCacheAndRemovedTasks() {
        withCache { cache ->
            val id = "test"
            val uri = Uri.parse("https://offline.genzo.invalid/$id/opaque.bin")
            val bytes = ByteArray(2048) { (it % 251).toByte() }
            writeCache(cache, uri, bytes)
            val bridge = OfflineVideoBridge(cache)
            val locator = bridge.locator(id, uri)
            request(locator, "bytes=100-199").let { (status, body, range) -> assertEquals(206, status); assertArrayEquals(bytes.copyOfRange(100, 200), body); assertEquals("bytes 100-199/2048", range) }
            request(locator, "bytes=-17").let { (status, body) -> assertEquals(206, status); assertArrayEquals(bytes.takeLast(17).toByteArray(), body) }
            assertEquals(416, request(locator, "bytes=3000-").first)
            val missing = bridge.locator(id, Uri.parse("https://offline.genzo.invalid/$id/missing.bin"))
            assertEquals(404, request(missing).first)
            bridge.remove(id); assertEquals(404, request(locator).first)
            bridge.close()
        }
    }

    @Test fun offlineHlsOnlyExposesLoopbackReferencesAndCachedAesKeyBytes() {
        withCache { cache ->
            val root = Uri.parse("https://offline.genzo.invalid/hls/root.m3u8")
            val key = Uri.parse("https://offline.genzo.invalid/hls/key.bin")
            val segment = Uri.parse("https://offline.genzo.invalid/hls/segment.bin")
            val playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-KEY:METHOD=AES-128,URI=\"$key\"\n#EXTINF:5,\n$segment\n#EXT-X-ENDLIST\n"
            writeCache(cache, root, playlist.toByteArray()); writeCache(cache, key, ByteArray(16) { it.toByte() }); writeCache(cache, segment, ByteArray(128) { 42 })
            val bridge = OfflineVideoBridge(cache)
            val body = request(bridge.locator("hls", root)).second.toString(Charsets.UTF_8)
            assertFalse(body.contains("offline.genzo.invalid")); assertFalse(body.contains("https://"))
            val keyUri = Regex("URI=\"([^\"]+)\"").find(body)!!.groupValues[1]
            assertEquals("127.0.0.1", URL(keyUri).host); assertArrayEquals(ByteArray(16) { it.toByte() }, request(keyUri).second)
            bridge.remove("hls")
            bridge.close()
        }
    }

    @Test fun cachedFileIsReadOnlyAndCannotEscapeTheGeneratedRemoteCache() {
        withCache { cache ->
            val context = ApplicationProvider.getApplicationContext<Context>()
            val root = File(context.dataDir, "remote-cache").apply { mkdirs() }
            val file = File(root, "${UUID.randomUUID()}.mp4")
            val bytes = ByteArray(2048) { (it % 251).toByte() }
            file.writeBytes(bytes)
            OfflineVideoBridge(cache).use { bridge ->
                try {
                    var locator = bridge.fileLocator(root, file.path)
                    request(locator, "bytes=127-255").let { (status, body, range) ->
                        assertEquals(206, status); assertArrayEquals(bytes.copyOfRange(127, 256), body); assertEquals("bytes 127-255/2048", range)
                    }
                    assertArrayEquals(bytes, file.readBytes())
                    repeat(140) {
                        val previous = locator
                        locator = bridge.fileLocator(root, file.path)
                        assertEquals(404, request(previous).first)
                    }
                    assertArrayEquals(bytes, request(locator).second)
                    for (invalid in listOf(File(context.cacheDir, file.name), File(root, "${UUID.randomUUID()}.part"), File(root, "../shared_prefs/genzo-encrypted-credentials.xml"))) {
                        try { bridge.fileLocator(root, invalid.path); fail("non-cache or partial files must not become playable") } catch (_: IllegalArgumentException) { }
                    }
                    file.delete(); assertEquals(404, request(locator).first)
                    file.writeBytes(bytes)
                    assertEquals("a previous token cannot read a replacement file", 404, request(locator).first)
                    assertArrayEquals(bytes, request(bridge.fileLocator(root, file.path)).second)
                } finally { file.delete() }
            }
        }
    }

    @Test fun durableProgressivePausesResumesAndPlaysWithoutItsOrigin() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("isolated QA package required", context.packageName.endsWith("qa"))
        val downloads = onMain { OfflineVideoDownloads.get(context) }
        await { onMain { downloads.manager.isInitialized } }
        val id = "qa_${UUID.randomUUID()}"
        val bytes = ByteArray(3 * 1024 * 1024) { (it % 251).toByte() }
        val secret = "qa-cookie-${UUID.randomUUID()}"
        val origin = FixtureServer(mapOf("/video.mp4" to ("video/mp4" to bytes)), delayMs = 8)
        try {
            val ticket = downloads.stage { downloads.prepare(id, "${origin.base}/video.mp4?token=$secret", mapOf("Cookie" to secret, "Authorization" to "Bearer $secret"), "QA progressive", null, null, null, org.json.JSONObject()) }
            val downloadRequest = downloads.commitTicket(ticket, id)
            assertFalse(downloadRequest.uri.toString().contains(secret))
            onMain { downloads.manager.addDownload(downloadRequest); downloads.manager.resumeDownloads() }
            await { onMain { downloads.manager.currentDownloads.firstOrNull { it.request.id == id }?.bytesDownloaded ?: 0 } > 65536 }
            onMain { downloads.manager.setStopReason(id, 1) }
            await { downloads.manager.downloadIndex.getDownload(id)?.state == Download.STATE_STOPPED }
            val stopped = downloads.manager.downloadIndex.getDownload(id)!!
            assertTrue(stopped.bytesDownloaded > 0)
            Thread.sleep(100)
            assertEquals(stopped.bytesDownloaded, downloads.manager.downloadIndex.getDownload(id)!!.bytesDownloaded)
            onMain { downloads.manager.setStopReason(id, Download.STOP_REASON_NONE) }
            await { downloads.manager.downloadIndex.getDownload(id)?.state == Download.STATE_COMPLETED }
            val saved = downloads.manager.downloadIndex.getDownload(id)!!
            assertFalse(String(saved.request.data).contains(secret)); assertFalse(saved.request.uri.toString().contains(secret))
            val encrypted = File(context.dataDir, "shared_prefs/genzo-encrypted-credentials.xml").readText()
            assertFalse(encrypted.contains(secret))
            val count = origin.requests.size
            origin.close()
            val uri = downloads.locator(id).getString("uri")
            request(uri, "bytes=12345-13000").let { (status, body) -> assertEquals(206, status); assertArrayEquals(bytes.copyOfRange(12345, 13001), body) }
            assertEquals(count, origin.requests.size)
            assertTrue(origin.requests.all { it.cookie == secret && it.authorization == "Bearer $secret" })
        } finally {
            origin.close(); onMain { downloads.manager.removeDownload(id) }
            await { downloads.manager.downloadIndex.getDownload(id) == null }
        }
    }

    @Test fun hlsDownloadsOnlyTheChosenVariantAndStripsCrossOriginCredentials() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("isolated QA package required", context.packageName.endsWith("qa"))
        val downloads = onMain { OfflineVideoDownloads.get(context) }
        await { onMain { downloads.manager.isInitialized } }
        val id = "qa_${UUID.randomUUID()}"
        val key = ByteArray(16) { it.toByte() }
        val keyServer = FixtureServer(mapOf("/key.bin" to ("application/octet-stream" to key)))
        val segment = ByteArray(4096) { 42 }
        val media = "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-KEY:METHOD=AES-128,URI=\"${keyServer.base}/key.bin\"\n#EXTINF:5,\n#EXT-X-BYTERANGE:128@256\nsegment.ts\n#EXTINF:5,\n#EXT-X-BYTERANGE:128@1024\nsegment.ts\n#EXT-X-ENDLIST\n"
        val master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=3840x2160\n2160.m3u8\n"
        val source = FixtureServer(mapOf("/master.m3u8" to ("application/vnd.apple.mpegurl" to master.toByteArray()),
            "/1080.m3u8" to ("application/vnd.apple.mpegurl" to media.toByteArray()), "/segment.ts" to ("video/mp2t" to segment)))
        try {
            val ticket = downloads.stage { downloads.prepare(id, "${source.base}/master.m3u8", mapOf("Cookie" to "private-cookie", "Authorization" to "Bearer private-authorization"), "QA HLS", null, null, null, org.json.JSONObject()) }
            val downloadRequest = downloads.commitTicket(ticket, id)
            onMain { downloads.manager.addDownload(downloadRequest); downloads.manager.resumeDownloads() }
            await { downloads.manager.downloadIndex.getDownload(id)?.state.let { it == Download.STATE_COMPLETED || it == Download.STATE_FAILED } }
            assertEquals(Download.STATE_COMPLETED, downloads.manager.downloadIndex.getDownload(id)!!.state)
            assertTrue(source.requests.none { it.path in listOf("/720.m3u8", "/2160.m3u8") })
            assertTrue(keyServer.requests.isNotEmpty()); assertTrue(keyServer.requests.all { it.cookie == null && it.authorization == null })
            source.close(); keyServer.close()
            val root = request(downloads.locator(id).getString("uri")).second.toString(Charsets.UTF_8)
            val child = root.lineSequence().first { it.startsWith("http://127.0.0.1") }
            val body = request(child).second.toString(Charsets.UTF_8)
            val keyUri = Regex("URI=\"([^\"]+)\"").find(body)!!.groupValues[1]
            assertArrayEquals(key, request(keyUri).second)
            val segmentUri = body.lineSequence().first { it.startsWith("http://127.0.0.1") }
            assertArrayEquals(segment.copyOfRange(256, 384), request(segmentUri, "bytes=256-383").second)
            assertArrayEquals(segment.copyOfRange(1024, 1152), request(segmentUri, "bytes=1024-1151").second)
            assertEquals(503, request(segmentUri, "bytes=500-600").first)
        } finally {
            source.close(); keyServer.close(); onMain { downloads.manager.removeDownload(id) }
            await { downloads.manager.downloadIndex.getDownload(id) == null }
        }
    }

    private fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync { result = runCatching(block) }
        return requireNotNull(result).getOrThrow()
    }
    private fun await(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 30000
        while (System.currentTimeMillis() < deadline) { if (condition()) return; Thread.sleep(25) }
        fail("offline download condition timed out")
    }

    private class FixtureServer(private val resources: Map<String, Pair<String, ByteArray>>, private val delayMs: Long = 0) : java.io.Closeable {
        data class Seen(val path: String, val cookie: String?, val authorization: String?)
        val requests = CopyOnWriteArrayList<Seen>()
        private val listener = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        private val sockets = CopyOnWriteArrayList<Socket>()
        private val workers = Executors.newCachedThreadPool()
        val base get() = "http://127.0.0.1:${listener.localPort}"
        init { Thread({
            while (!listener.isClosed) {
                val socket = runCatching { listener.accept() }.getOrNull() ?: break
                sockets.add(socket)
                workers.execute { socket.use { runCatching { serve(it) } }; sockets.remove(socket) }
            }
        }, "GenzoOfflineFixture").apply { isDaemon = true; start() } }
        private fun serve(socket: Socket) {
            socket.soTimeout = 5000
            val input = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
            val line = input.readLine() ?: return
            val path = line.split(' ')[1].substringBefore('?')
            val headers = mutableMapOf<String, String>()
            while (true) { val header = input.readLine() ?: return; if (header.isEmpty()) break; headers[header.substringBefore(':').lowercase()] = header.substringAfter(':').trim() }
            requests.add(Seen(path, headers["cookie"], headers["authorization"]))
            val resource = resources[path] ?: run { socket.getOutputStream().write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); return }
            val bytes = resource.second
            val range = headers["range"]?.let { Regex("bytes=(\\d+)-(\\d*)").matchEntire(it) }
            val start = range?.groupValues?.get(1)?.toInt() ?: 0
            val end = range?.groupValues?.get(2)?.takeIf { it.isNotEmpty() }?.toInt()?.coerceAtMost(bytes.lastIndex) ?: bytes.lastIndex
            val output = socket.getOutputStream()
            val contentRange = if (range != null) "Content-Range: bytes $start-$end/${bytes.size}\r\n" else ""
            output.write("HTTP/1.1 ${if (range != null) "206 Partial Content" else "200 OK"}\r\nContent-Type: ${resource.first}\r\nContent-Length: ${end - start + 1}\r\n${contentRange}Accept-Ranges: bytes\r\nConnection: close\r\n\r\n".toByteArray())
            var offset = start
            while (offset <= end) { val count = minOf(16384, end - offset + 1); output.write(bytes, offset, count); output.flush(); offset += count; if (delayMs > 0) Thread.sleep(delayMs) }
        }
        override fun close() { listener.close(); sockets.forEach { runCatching { it.close() } }; workers.shutdownNow() }
    }

    private fun withCache(test: (SimpleCache) -> Unit) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("isolated QA package required", context.packageName.endsWith("qa"))
        val directory = File(context.cacheDir, "offline-test-${UUID.randomUUID()}")
        val cache = SimpleCache(directory, NoOpCacheEvictor(), StandaloneDatabaseProvider(context))
        try { test(cache) } finally { cache.release(); directory.deleteRecursively() }
    }
    private fun writeCache(cache: SimpleCache, uri: Uri, bytes: ByteArray) {
        val hole = cache.startReadWrite(uri.toString(), 0, bytes.size.toLong())
        try {
            val file = cache.startFile(uri.toString(), 0, bytes.size.toLong()); file.writeBytes(bytes); cache.commitFile(file, bytes.size.toLong())
            val metadata = ContentMetadataMutations(); ContentMetadataMutations.setContentLength(metadata, bytes.size.toLong())
            cache.applyContentMetadataMutations(uri.toString(), metadata)
        } finally { cache.releaseHoleSpan(hole) }
    }
    private fun request(uri: String, range: String? = null): Triple<Int, ByteArray, String?> {
        val connection = URL(uri).openConnection() as HttpURLConnection
        connection.connectTimeout = 5000; connection.readTimeout = 5000
        if (range != null) connection.setRequestProperty("Range", range)
        return try {
            val status = connection.responseCode
            Triple(status, if (status in 200..299) connection.inputStream.use { it.readBytes() } else ByteArray(0), connection.getHeaderField("Content-Range"))
        } finally { connection.disconnect() }
    }
}
