package com.genzo.android

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.plugin.JSObject
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal data class AppUpdateOffer(val version: String, val name: String, val url: String, val size: Long, val checksumUrl: String, val digest: String)

internal object AppUpdatePolicy {
    const val REPOSITORY = "Boringchen-10/genzo"
    const val MAX_APK_BYTES = 512L * 1024 * 1024
    private fun version(value: String): List<Int>? {
        return Regex("^v?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$").matchEntire(value)
            ?.groupValues?.drop(1)?.map { it.toIntOrNull() ?: return null }
    }
    fun newer(candidate: String, current: String): Boolean {
        val next = version(candidate) ?: return false
        val old = version(current) ?: return false
        for (index in next.indices) if (next[index] != old[index]) return next[index] > old[index]
        return false
    }
    fun trustedUrl(value: String, initial: Boolean): Boolean = runCatching {
        val uri = java.net.URI(value)
        uri.scheme == "https" && uri.rawUserInfo == null && uri.fragment == null && uri.port == -1 &&
            if (initial) uri.host == "github.com" && uri.path.startsWith("/$REPOSITORY/releases/download/")
            else uri.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")
    }.getOrDefault(false)
    fun checksum(text: String, name: String): String? = text.lineSequence().mapNotNull { line ->
        val match = Regex("^([a-fA-F0-9]{64})[ \\t]+\\*?(.+?)\\s*$").matchEntire(line) ?: return@mapNotNull null
        if (match.groupValues[2] == name) match.groupValues[1].lowercase() else null
    }.singleOrNull()
    fun offer(releases: JSONArray, current: String, abi: String): AppUpdateOffer? {
        var selected: AppUpdateOffer? = null
        for (index in 0 until releases.length()) {
            val release = releases.getJSONObject(index)
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue
            val tag = release.optString("tag_name")
            val version = tag.removePrefix("v")
            if (!newer(version, selected?.version ?: current)) continue
            val names = listOf("Yuki_${version}_android_${abi}.apk", "Genzo_${version}_android_${abi}.apk")
            val assets = release.optJSONArray("assets") ?: continue
            var apk: JSONObject? = null
            var sums = ""
            for (assetIndex in 0 until assets.length()) {
                val asset = assets.getJSONObject(assetIndex)
                if (asset.optString("name") in names && (apk == null || asset.optString("name") == names.first())) apk = asset
                if (asset.optString("name") == "SHA256SUMS.txt") sums = asset.optString("browser_download_url")
            }
            val file = apk ?: continue
            val name = file.getString("name")
            val url = file.optString("browser_download_url")
            val size = file.optLong("size")
            val digest = file.optString("digest").removePrefix("sha256:").lowercase().takeIf { it.matches(Regex("[a-f0-9]{64}")) } ?: ""
            val prefix = "https://github.com/$REPOSITORY/releases/download/$tag/"
            if (url != prefix + name || !trustedUrl(url, true) || size !in 1..MAX_APK_BYTES) continue
            if (digest.isEmpty() && (sums != prefix + "SHA256SUMS.txt" || !trustedUrl(sums, true))) continue
            selected = AppUpdateOffer(version, name, url, size, sums, digest)
        }
        return selected
    }
    fun validateIdentity(packageName: String, versionCode: Long, signers: Set<String>, installedName: String, installedCode: Long, installedSigners: Set<String>) {
        require(packageName == installedName) { "安装包与当前应用包名不一致" }
        require(versionCode > installedCode) { "安装包版本未高于当前版本" }
        require(signers.isNotEmpty() && signers == installedSigners) { "安装包签名与当前应用不一致，已阻止安装" }
    }
    fun copyVerified(input: InputStream, file: File, size: Long, digest: String, progress: (Long) -> Unit) {
        val hash = MessageDigest.getInstance("SHA-256")
        var count = 0L
        file.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read == -1) break
                count += read
                require(count <= size && count <= MAX_APK_BYTES) { "安装包大小与发布记录不一致" }
                output.write(buffer, 0, read)
                hash.update(buffer, 0, read)
                progress(count)
            }
            output.flush()
        }
        require(count == size) { "安装包下载不完整，请重试" }
        require(hash.digest().joinToString("") { "%02x".format(it) } == digest) { "安装包 SHA-256 校验失败，请重试" }
    }
}

/** Only official release APKs enter the private update cache; installation remains an explicit system action. */
internal object AppUpdater {
    private val worker = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    private var phase = "idle"
    private var offer: AppUpdateOffer? = null
    private var downloaded = 0L
    private var error = ""
    private var operation = 0L
    private var activeCall: Call? = null
    private var readyFile: File? = null
    private var verifiedDigest = ""

    @Suppress("DEPRECATION")
    private fun packageInfo(activity: Activity, path: String? = null): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        return (if (path == null) activity.packageManager.getPackageInfo(activity.packageName, flags)
            else activity.packageManager.getPackageArchiveInfo(path, flags)) ?: error("无法读取安装包信息")
    }
    @Suppress("DEPRECATION")
    private fun code(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> = (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)
        ?.map { it.toCharsString() }?.toSet() ?: emptySet()
    internal fun validateArchive(activity: Activity, file: File) {
        val installed = packageInfo(activity)
        val next = packageInfo(activity, file.absolutePath)
        AppUpdatePolicy.validateIdentity(next.packageName, code(next), signers(next), installed.packageName, code(installed), signers(installed))
    }
    fun status(activity: Activity): JSObject = synchronized(lock) {
        JSObject().put("phase", phase).put("currentVersion", packageInfo(activity).versionName ?: "")
            .put("version", offer?.version ?: "").put("bytes", downloaded).put("total", offer?.size ?: 0)
            .put("error", error).put("canInstall", Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls())
    }
    private fun busy() = phase in setOf("checking", "downloading", "installing")
    private fun current(id: Long) = synchronized(lock) { operation == id }
    private fun update(id: Long, action: () -> Unit) = synchronized(lock) { if (operation == id) action() }
    private fun fail(id: Long, exception: Exception) = update(id) {
        phase = "error"
        error = when (exception) {
            is IllegalArgumentException -> exception.message ?: "更新资料无效"
            is java.io.IOException -> "网络连接失败或下载中断，请检查网络后重试"
            else -> "无法完成更新操作，请稍后重试"
        }
    }
    private fun response(id: Long, address: String, api: Boolean = false): Response {
        var url = address
        repeat(6) {
            check(current(id))
            require(if (api) url == "https://api.github.com/repos/${AppUpdatePolicy.REPOSITORY}/releases?per_page=30" else AppUpdatePolicy.trustedUrl(url, false)) { "更新下载地址不受信任" }
            val call = client.newCall(Request.Builder().url(url).header("User-Agent", "Yuki-Android-Updater")
                .header("Accept", if (api) "application/vnd.github+json" else "application/octet-stream").build())
            // Metadata and headers are bounded; the APK body uses an idle timeout so large downloads can finish.
            call.timeout().timeout(if (api) 20 else 0, TimeUnit.SECONDS)
            synchronized(lock) { check(operation == id); activeCall = call }
            val reply = call.execute()
            if (reply.code in listOf(301, 302, 303, 307, 308)) {
                val next = reply.header("Location")?.let { reply.request.url.resolve(it)?.toString() }
                reply.close()
                require(!api && next != null && AppUpdatePolicy.trustedUrl(next, false)) { "更新下载重定向无效" }
                url = next
            } else {
                if (!reply.isSuccessful) {
                    val status = reply.code
                    reply.close()
                    throw IllegalArgumentException(if (status == 403 || status == 429) "更新服务暂时限流，请稍后重试" else "更新服务返回 HTTP $status，请稍后重试")
                }
                return reply
            }
        }
        throw IllegalArgumentException("更新下载重定向次数过多")
    }
    private fun text(id: Long, url: String, api: Boolean = false): String = response(id, url, api).use { reply ->
        val input = reply.body?.byteStream() ?: throw java.io.IOException()
        val bytes = input.readBytesLimited(2 * 1024 * 1024)
        String(bytes, Charsets.UTF_8)
    }
    private fun InputStream.readBytesLimited(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) { val read = read(buffer); if (read == -1) break; require(output.size() + read <= limit) { "更新资料过大" }; output.write(buffer, 0, read) }
        return output.toByteArray()
    }
    fun check(activity: Activity): JSObject {
        val id = synchronized(lock) { if (busy()) return status(activity); phase = "checking"; error = ""; ++operation }
        worker.execute { try {
            val releases = JSONArray(text(id, "https://api.github.com/repos/${AppUpdatePolicy.REPOSITORY}/releases?per_page=30", true))
            val abi = Build.SUPPORTED_ABIS.firstOrNull { it in setOf("arm64-v8a", "x86_64") } ?: "unsupported"
            val next = AppUpdatePolicy.offer(releases, packageInfo(activity).versionName ?: "", abi)
            update(id) { offer = next; downloaded = 0; readyFile = null; verifiedDigest = ""; phase = if (next == null) "current" else "available" }
        } catch (exception: Exception) { fail(id, exception) } }
        return status(activity)
    }
    fun download(activity: Activity): JSObject {
        val (id, selected) = synchronized(lock) {
            if (busy() || offer == null) return status(activity)
            phase = "downloading"; error = ""; downloaded = 0
            Pair(++operation, offer!!)
        }
        worker.execute {
            val directory = File(activity.cacheDir, "updates")
            val part = File(directory, "${selected.name}.part")
            try {
                require(directory.isDirectory || directory.mkdirs()) { "无法创建更新缓存目录" }
                val digest = selected.digest.ifEmpty { AppUpdatePolicy.checksum(text(id, selected.checksumUrl), selected.name)
                    ?: throw IllegalArgumentException("发布未提供唯一有效的安装包校验值") }
                response(id, selected.url).use { reply ->
                    val length = reply.body?.contentLength() ?: -1
                    require(length == -1L || length == selected.size) { "安装包大小与发布记录不一致" }
                    val input = reply.body?.byteStream() ?: throw java.io.IOException()
                    AppUpdatePolicy.copyVerified(input, part, selected.size, digest) { count ->
                        check(current(id)); update(id) { downloaded = count }
                    }
                }
                validateArchive(activity, part)
                synchronized(lock) {
                    check(operation == id)
                    val file = File(directory, selected.name)
                    require(part.renameTo(file)) { "无法保存已校验的安装包" }
                    readyFile = file; verifiedDigest = digest; phase = "ready"
                }
            } catch (exception: Exception) { fail(id, exception) }
            finally { part.delete() }
        }
        return status(activity)
    }
    fun cancel(activity: Activity): JSObject = synchronized(lock) {
        ++operation; activeCall?.cancel(); activeCall = null
        phase = if (readyFile != null) "ready" else if (offer != null) "available" else "idle"
        error = ""; downloaded = 0
        status(activity)
    }
    fun install(activity: Activity): JSObject {
        val (id, file, digest) = synchronized(lock) {
            if (busy() || readyFile == null) return status(activity)
            phase = "installing"; error = ""
            Triple(++operation, readyFile!!, verifiedDigest)
        }
        worker.execute { try {
            // Recheck immediately before granting access, including a file changed after download.
            val hash = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count == -1) break; hash.update(buffer, 0, count) } }
            require(hash.digest().joinToString("") { "%02x".format(it) } == digest) { "安装包校验失败，请重新下载" }
            validateArchive(activity, file)
            activity.runOnUiThread {
                if (!current(id)) return@runOnUiThread
                try {
                    if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
                        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                        update(id) { phase = "permission" }
                    } else {
                        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        update(id) { phase = "ready" }
                    }
                } catch (exception: Exception) { fail(id, exception) }
            }
        } catch (exception: Exception) { fail(id, exception) } }
        return status(activity)
    }
}
