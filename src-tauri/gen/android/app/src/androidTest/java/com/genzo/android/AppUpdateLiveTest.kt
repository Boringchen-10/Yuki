package com.genzo.android

import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Explicit release smoke test, selected separately from offline policy checks. */
@RunWith(AndroidJUnit4::class)
class AppUpdateLiveTest {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build()
    private fun response(address: String): Response {
        var url = address
        repeat(6) {
            check(AppUpdatePolicy.trustedUrl(url, false))
            val reply = client.newCall(Request.Builder().url(url).build()).execute()
            if (reply.code in listOf(301, 302, 303, 307, 308)) {
                val next = reply.header("Location")?.let { reply.request.url.resolve(it)?.toString() }
                reply.close(); url = requireNotNull(next)
            } else { check(reply.isSuccessful); return reply }
        }
        error("Too many release redirects")
    }
    @Test fun publicManifestOffersAndVerifiesOfficialApkWithoutApi() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        check(context.packageName == "com.genzo.android.updateqa")
        val calls = mutableListOf<String>()
        val offer = requireNotNull(AppUpdatePolicy.resolve("1.0.0", "arm64-v8a") { url, api ->
            assertFalse("The public manifest must work without the API", api)
            assertEquals(AppUpdatePolicy.MANIFEST, url); calls.add(url)
            response(url).use { requireNotNull(it.body).string().also { text -> check(text.length < 65536) } }
        })
        assertEquals(listOf(AppUpdatePolicy.MANIFEST), calls)
        val file = File.createTempFile("release-smoke-", ".apk", context.cacheDir)
        try {
            response(offer.url).use { reply ->
                AppUpdatePolicy.copyVerified(requireNotNull(reply.body).byteStream(), file, offer.size, offer.digest) { }
            }
            val archive = requireNotNull(context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES))
            val signers = requireNotNull(archive.signingInfo).apkContentsSigners.map { signer ->
                MessageDigest.getInstance("SHA-256").digest(signer.toByteArray()).joinToString("") { "%02x".format(it) }
            }.toSet()
            AppUpdatePolicy.validateIdentity(archive.packageName, archive.longVersionCode, signers,
                "com.genzo.android", 1000000, setOf("cee90e5f49edc18217ec2d1f7cdf360f50b61af1e99e4eefdb0837b549c13cdb"))
            assertEquals(offer.version, archive.versionName)
        } finally { file.delete() }
    }
}
