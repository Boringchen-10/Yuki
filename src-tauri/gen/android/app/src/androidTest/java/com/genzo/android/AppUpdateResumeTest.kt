package com.genzo.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class AppUpdateResumeTest {
    @Test fun aDroppedHttpBodyResumesWithRangeAndVerifiesAllBytes() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("isolated QA package required", context.packageName.endsWith("qa"))
        val file = File.createTempFile("update-resume-fixture-", ".part", context.cacheDir)
        val bytes = ByteArray(130001) { (it % 241).toByte() }
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val ranges = CopyOnWriteArrayList<String>()
        val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val worker = Thread {
            runCatching {
                repeat(2) { attempt ->
                    server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val input = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
                        input.readLine()
                        var range = ""
                        while (true) { val line = input.readLine() ?: break; if (line.isEmpty()) break; if (line.startsWith("Range:",true)) range = line.substringAfter(':').trim() }
                        ranges.add(range)
                        val offset = range.removePrefix("bytes=").substringBefore('-').toIntOrNull() ?: 0
                        val output = socket.getOutputStream()
                        val header = if (attempt == 0) "HTTP/1.1 200 OK\r\n" else "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes $offset-${bytes.lastIndex}/${bytes.size}\r\n"
                        output.write((header + "Content-Length: ${bytes.size-offset}\r\nConnection: close\r\n\r\n").toByteArray())
                        output.write(bytes,offset,if (attempt == 0) 16384 else bytes.size-offset); output.flush()
                    }
                }
            }
        }.apply { isDaemon = true; start() }
        val client = OkHttpClient.Builder().connectTimeout(5,TimeUnit.SECONDS).readTimeout(5,TimeUnit.SECONDS).build()
        fun request(offset: Long) = client.newCall(Request.Builder().url("http://127.0.0.1:${server.localPort}/fixture.apk")
            .header("Accept-Encoding","identity").apply { if (offset > 0) header("Range","bytes=$offset-") }.build()).execute()
        try {
            try { AppUpdateTransfer.download(file,bytes.size.toLong(),hash,::request) { }; fail("Truncated response must fail") }
            catch (_: IOException) { }
            val retained = AppUpdateTransfer.retained(file,bytes.size.toLong(),hash)
            assertEquals(16384L,retained); assertArrayEquals(bytes.copyOf(16384),file.readBytes())
            AppUpdateTransfer.download(file,bytes.size.toLong(),hash,::request) { }
            assertEquals(listOf("","bytes=$retained-"),ranges.toList()); assertArrayEquals(bytes,file.readBytes())
        } finally {
            server.close(); worker.join(5000); AppUpdateTransfer.clear(file)
            client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll()
        }
    }
}
