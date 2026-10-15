package com.genzo.android

import android.net.Uri
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.SimpleCache
import java.io.BufferedInputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

/** A loopback capability exposes only Media3 cache bytes. There is deliberately no upstream factory. */
internal class OfflineVideoBridge(private val cache: SimpleCache) : java.io.Closeable {
    private data class Session(val id: String, val token: String = UUID.randomUUID().toString(),
        val resources: ConcurrentHashMap<String, Uri> = ConcurrentHashMap())
    private data class CachedFile(val path: File, val input: RandomAccessFile) {
        val identity = android.system.Os.fstat(input.fd)
        fun exists(): Boolean = runCatching {
            val current = android.system.Os.stat(path.path)
            path.canonicalFile == path && current.st_dev == identity.st_dev && current.st_ino == identity.st_ino
        }.getOrDefault(false)
    }
    private val sessions = ConcurrentHashMap<String, Session>()
    private val files = ConcurrentHashMap<String, CachedFile>()
    private val listener = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val slots = Semaphore(4)
    private val workers = Executors.newFixedThreadPool(4) { runnable -> Thread(runnable, "GenzoOfflineRead").apply { isDaemon = true } }
    init {
        Thread({
            while (!listener.isClosed) {
                val socket = runCatching { listener.accept() }.getOrNull() ?: break
                if (!slots.tryAcquire()) { socket.close(); continue }
                workers.execute { socket.use { runCatching { serve(it) } }; slots.release() }
            }
        }, "GenzoOfflineVideo").apply { isDaemon = true; start() }
    }
    @Synchronized fun locator(id: String, root: Uri): String {
        revokePrevious()
        return resource(Session(id).also { sessions[id] = it }, root)
    }
    @Synchronized fun fileLocator(root: File, raw: String): String {
        val directory = root.canonicalFile
        val file = File(raw).canonicalFile
        require(file.parentFile == directory && file.isFile && file.canRead() && file.length() > 0 && !file.name.endsWith(".part", true))
        require(file.name.matches(Regex("[A-Fa-f0-9-]{36}\\.[A-Za-z0-9]{1,16}")))
        UUID.fromString(file.name.substringBeforeLast('.'))
        val opened = CachedFile(file, RandomAccessFile(file, "r"))
        revokePrevious()
        val token = UUID.randomUUID().toString()
        files[token] = opened
        return "http://127.0.0.1:${listener.localPort}/$token/file"
    }
    fun remove(id: String) { sessions.remove(id) }
    private fun revokePrevious() {
        sessions.clear()
        val previous = files.values.toList(); files.clear()
        previous.forEach { runCatching { it.input.close() } }
    }
    @Synchronized override fun close() { revokePrevious(); listener.close(); workers.shutdownNow() }
    private fun resource(session: Session, uri: Uri): String {
        require(uri.host == "offline.genzo.invalid" && uri.pathSegments.firstOrNull() == session.id)
        check(session.resources.size < 100000)
        val hash = MessageDigest.getInstance("SHA-256").digest(uri.toString().toByteArray()).joinToString("") { "%02x".format(it) }
        val key = "$hash.${if (uri.lastPathSegment?.endsWith(".m3u8") == true) "m3u8" else "stream"}"
        session.resources[key] = uri
        return "http://127.0.0.1:${listener.localPort}/${session.token}/$key"
    }
    private fun source() = CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(null).setCacheWriteDataSinkFactory(null).createDataSource()
    private fun serve(socket: Socket) {
        socket.soTimeout = 10000
        val input = BufferedInputStream(socket.getInputStream())
        val raw = StringBuilder()
        while (raw.length < 16384 && !raw.endsWith("\r\n\r\n")) {
            val next = input.read(); if (next < 0) return
            raw.append(next.toChar())
        }
        if (!raw.endsWith("\r\n\r\n")) { empty(socket, "431 Request Header Fields Too Large"); return }
        val lines = raw.toString().split("\r\n")
        val request = lines[0].split(' ')
        if (request.size != 3 || request[0] !in listOf("GET", "HEAD")) { empty(socket, "405 Method Not Allowed"); return }
        val path = request[1].substringBefore('?').split('/')
        if (path.size != 3) { empty(socket, "404 Not Found"); return }
        val range = lines.drop(1).firstOrNull { it.startsWith("Range:", true) }?.substringAfter(':')?.trim()
        val head = request[0] == "HEAD"
        files[path[1]]?.let { file ->
            if (path[2] != "file" || !file.exists()) { empty(socket, "404 Not Found"); return }
            file.input.let { inputFile ->
                val length = file.identity.st_size
                val selected = range(range, length) ?: run { empty(socket, "416 Range Not Satisfiable", length); return }
                headers(socket, if (range == null) "200 OK" else "206 Partial Content", selected, length, "application/octet-stream", range != null)
                if (!head) {
                    val output = socket.getOutputStream(); val buffer = ByteBuffer.allocate(65536)
                    var remaining = selected.last - selected.first + 1
                    while (remaining > 0) {
                        buffer.clear(); buffer.limit(minOf(buffer.capacity().toLong(), remaining).toInt())
                        val count = inputFile.channel.read(buffer, selected.last - remaining + 1)
                        check(count > 0); output.write(buffer.array(), 0, count); remaining -= count
                    }
                }
            }
            return
        }
        val session = sessions.values.firstOrNull { it.token == path[1] } ?: run { empty(socket, "404 Not Found"); return }
        val uri = session.resources[path[2]] ?: run { empty(socket, "404 Not Found"); return }
        val data = source()
        try {
            val declaredLength = ContentMetadata.getContentLength(cache.getContentMetadata(uri.toString()))
            val contentLength = if (declaredLength >= 0) declaredLength else cache.getCachedSpans(uri.toString()).maxOfOrNull { it.position + it.length } ?: -1
            if (contentLength <= 0) { empty(socket, "404 Not Found"); return }
            if (uri.lastPathSegment?.endsWith(".m3u8") == true) {
                if (!cache.isCached(uri.toString(), 0, contentLength)) { empty(socket, "503 Service Unavailable"); return }
                data.open(DataSpec.Builder().setUri(uri).build())
                val text = String(readBounded(data, 32 * 1024 * 1024), Charsets.UTF_8)
                val body = rewriteOfflinePlaylist(text) { value -> if (value.startsWith("data:")) value else resource(session, Uri.parse(value)) }.toByteArray(Charsets.UTF_8)
                val selected = range(range, body.size.toLong()) ?: run { empty(socket, "416 Range Not Satisfiable", body.size.toLong()); return }
                headers(socket, if (range == null) "200 OK" else "206 Partial Content", selected, body.size.toLong(), "application/vnd.apple.mpegurl", range != null)
                if (!head) socket.getOutputStream().write(body, selected.first.toInt(), (selected.last - selected.first + 1).toInt())
            } else {
                val selected = range(range, contentLength) ?: run { empty(socket, "416 Range Not Satisfiable", contentLength); return }
                val size = selected.last - selected.first + 1
                if (!cache.isCached(uri.toString(), selected.first, size)) { empty(socket, "503 Service Unavailable"); return }
                headers(socket, if (range == null) "200 OK" else "206 Partial Content", selected, contentLength, "application/octet-stream", range != null)
                if (!head) {
                    data.open(DataSpec.Builder().setUri(uri).setPosition(selected.first).setLength(size).build())
                    val output = socket.getOutputStream(); val buffer = ByteArray(65536)
                    var remaining = size
                    while (remaining > 0) {
                        val count = data.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                        check(count > 0); output.write(buffer, 0, count); remaining -= count
                    }
                }
            }
        } finally { data.close() }
    }
    private fun range(header: String?, size: Long): LongRange? {
        if (header == null) return 0 until size
        val match = Regex("bytes=(\\d*)-(\\d*)").matchEntire(header) ?: return null
        val (left, right) = match.destructured
        if (left.isEmpty()) {
            val suffix = right.toLongOrNull()?.takeIf { it > 0 } ?: return null
            return maxOf(0, size - suffix) until size
        }
        val start = left.toLongOrNull()?.takeIf { it < size } ?: return null
        val end = if (right.isEmpty()) size - 1 else right.toLongOrNull()?.coerceAtMost(size - 1) ?: return null
        return if (end >= start) start..end else null
    }
    private fun headers(socket: Socket, status: String, range: LongRange, size: Long, type: String, partial: Boolean) {
        val contentRange = if (partial) "Content-Range: bytes ${range.first}-${range.last}/$size\r\n" else ""
        socket.getOutputStream().write(("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${range.last - range.first + 1}\r\n$contentRange" +
            "Accept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
    }
    private fun empty(socket: Socket, status: String, size: Long? = null) {
        val extra = if (size != null) "Content-Range: bytes */$size\r\n" else ""
        socket.getOutputStream().write("HTTP/1.1 $status\r\nContent-Length: 0\r\n${extra}Connection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    }
}
