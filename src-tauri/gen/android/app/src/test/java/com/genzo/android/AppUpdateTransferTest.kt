package com.genzo.android

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.buffer
import okio.source
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.security.MessageDigest

class AppUpdateTransferTest {
    private val bytes = ByteArray(32769) { (it % 251).toByte() }
    private val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun reply(code: Int, data: ByteArray, range: String? = null): Response = Response.Builder()
        .request(Request.Builder().url("https://example.test/fixture").build()).protocol(Protocol.HTTP_1_1)
        .code(code).message("fixture").body(data.toResponseBody()).apply { if (range != null) header("Content-Range", range) }.build()
    private fun fixture(test: (File) -> Unit) {
        val folder = Files.createTempDirectory("yuki-update-test-").toFile()
        try { test(File(folder, "fixture.apk.part")) } finally { folder.deleteRecursively() }
    }
    private fun partial(file: File, data: ByteArray = bytes.copyOf(4096), hash: String = digest) {
        file.writeBytes(data); File(file.path + ".identity").writeText("${bytes.size}\n$hash")
    }

    @Test fun resumesAcrossANewCallAndRehashesTheCompleteFile() = fixture { file ->
        partial(file)
        AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { offset ->
            assertEquals(4096L, offset)
            reply(206, bytes.copyOfRange(offset.toInt(), bytes.size), "bytes $offset-${bytes.lastIndex}/${bytes.size}")
        }) { }
        assertArrayEquals(bytes, file.readBytes())
        AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { error("Complete file needs no network") }) { }
    }
    @Test fun aServerIgnoringRangeReplacesThePartialInsteadOfAppending() = fixture { file ->
        partial(file)
        AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { reply(200, bytes) }) { }
        assertArrayEquals(bytes, file.readBytes())
    }
    @Test fun anUnsatisfiedRangeRestartsOnceFromZero() = fixture { file ->
        partial(file); val offsets = mutableListOf<Long>()
        AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { offset ->
            offsets.add(offset); if (offset > 0) reply(416, byteArrayOf()) else reply(200, bytes)
        }) { }
        assertEquals(listOf(4096L, 0L), offsets); assertArrayEquals(bytes, file.readBytes())
    }
    @Test fun interruptedBodyKeepsOnlyTheBytesActuallyWritten() = fixture { file ->
        val source = object : InputStream() {
            var position = 0
            override fun read(): Int { if (position >= 5000) throw IOException("fixture interruption"); return bytes[position++].toInt() and 255 }
        }.source().buffer()
        val body = object : ResponseBody() {
            override fun contentType() = null
            override fun contentLength() = bytes.size.toLong()
            override fun source() = source
        }
        try {
            AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { reply(200, bytes).newBuilder().body(body).build() }) { }
            fail("Interrupted input must fail")
        } catch (_: IOException) { }
        assertEquals(5000L, AppUpdateTransfer.retained(file, bytes.size.toLong(), digest))
        assertArrayEquals(bytes.copyOf(5000), file.readBytes())
    }
    @Test fun wrongRangeOrCorruptPrefixNeverBecomesAVerifiedApk() = fixture { file ->
        for (wrongRange in listOf(true, false)) {
            partial(file, if (wrongRange) bytes.copyOf(4096) else ByteArray(4096))
            try {
                AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { offset ->
                    reply(206, bytes.copyOfRange(4096, bytes.size), "bytes ${if (wrongRange) 1 else offset}-${bytes.lastIndex}/${bytes.size}")
                }) { }
                fail("Must reject inconsistent content")
            } catch (_: IllegalArgumentException) { }
            assertFalse(file.exists()); assertFalse(File(file.path + ".identity").exists())
        }
    }
    @Test fun changedReleaseIdentityAndOversizedCacheStartFromZero() = fixture { file ->
        for (oversized in listOf(false, true)) {
            partial(file, if (oversized) bytes + bytes else bytes.copyOf(4096), if (oversized) digest else "0".repeat(64))
            AppUpdateTransfer.download(file, bytes.size.toLong(), digest, { offset -> assertEquals(0L, offset); reply(200, bytes) }) { }
            assertArrayEquals(bytes, file.readBytes())
        }
    }
    @Test fun cancellationKeepsAResumablePrefix() = fixture { file ->
        val payload = ByteArray(200000) { (it % 239).toByte() }
        val hash = MessageDigest.getInstance("SHA-256").digest(payload).joinToString("") { "%02x".format(it) }
        try {
            AppUpdateTransfer.download(file, payload.size.toLong(), hash, { reply(200, payload) }) { count ->
                if (count >= 65536) throw java.util.concurrent.CancellationException("fixture pause")
            }
            fail("Must pause")
        } catch (_: java.util.concurrent.CancellationException) { }
        val retained = AppUpdateTransfer.retained(file, payload.size.toLong(), hash)
        assertTrue(retained in 65536 until payload.size.toLong())
        AppUpdateTransfer.download(file, payload.size.toLong(), hash, { offset ->
            assertEquals(retained, offset)
            reply(206, payload.copyOfRange(offset.toInt(), payload.size), "bytes $offset-${payload.lastIndex}/${payload.size}")
        }) { }
        assertArrayEquals(payload, file.readBytes())
    }
}
