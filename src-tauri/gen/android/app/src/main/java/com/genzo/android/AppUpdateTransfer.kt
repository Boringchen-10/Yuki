package com.genzo.android

import okhttp3.Response
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/** A partial APK belongs to one published size/hash, across retries and process restarts. */
internal object AppUpdateTransfer {
    private fun identity(file: File) = File(file.path + ".identity")
    fun retained(file: File, size: Long, digest: String): Long =
        if (file.isFile && file.length() <= size && runCatching { identity(file).readText() == "$size\n$digest" }.getOrDefault(false)) file.length() else 0

    fun clear(file: File) { file.delete(); identity(file).delete() }

    fun download(file: File, size: Long, digest: String, request: (Long) -> Response, progress: (Long) -> Unit) {
        require(size in 1..AppUpdatePolicy.MAX_APK_BYTES && Regex("[0-9a-f]{64}").matches(digest)) { "安装包校验资料无效" }
        var offset = retained(file, size, digest)
        if (offset == 0L) { clear(file); identity(file).writeText("$size\n$digest") }
        progress(offset)
        try {
            if (offset < size) {
                var reply = request(offset)
                if (reply.code == 416 && offset > 0) {
                    reply.close(); file.delete(); offset = 0
                    progress(0); reply = request(0)
                }
                reply.use { response ->
                    if (response.code == 200) offset = 0
                    else if (response.code == 206) {
                        val range = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(response.header("Content-Range") ?: "")
                        require(range != null && range.groupValues[1].toLongOrNull() == offset &&
                            range.groupValues[2].toLongOrNull() == size - 1 && range.groupValues[3].toLongOrNull() == size) { "安装包断点响应无效，请重新下载" }
                    } else throw IOException("update HTTP ${response.code}")
                    val body = response.body ?: throw IOException("update body missing")
                    require(body.contentLength() == -1L || body.contentLength() == size - offset) { "安装包大小与发布记录不一致" }
                    progress(offset)
                    var count = offset
                    file.outputStreamAt(offset > 0).use { output ->
                        body.byteStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read == -1) break
                                require(count + read <= size) { "安装包大小与发布记录不一致" }
                                output.write(buffer, 0, read); count += read; progress(count)
                            }
                        }
                    }
                    if (count != size) throw IOException("update interrupted")
                }
            }
            val hash = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) { val read = input.read(buffer); if (read == -1) break; hash.update(buffer, 0, read) }
            }
            require(hash.digest().joinToString("") { "%02x".format(it) } == digest) { "安装包 SHA-256 校验失败，请重新下载" }
        } catch (error: IllegalArgumentException) { clear(file); throw error }
    }

    private fun File.outputStreamAt(append: Boolean) = java.io.FileOutputStream(this, append)
}
