package com.genzo.android

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class AppUpdatePolicyTest {
    private fun release(version: String, abi: String = "arm64-v8a", prerelease: Boolean = false, brand: String = "Genzo"): JSONObject {
        val name = "${brand}_${version}_android_${abi}.apk"
        return JSONObject().put("tag_name", "v$version").put("prerelease", prerelease).put("assets", JSONArray()
            .put(JSONObject().put("name", name).put("size", 100).put("digest", "sha256:" + "a".repeat(64))
                .put("browser_download_url", "https://github.com/Boringchen-10/genzo/releases/download/v$version/$name")))
    }
    @Test fun releaseSelectionSkipsWindowsOldPreviewAndWrongAbi() {
        val releases = JSONArray().put(release("0.5.2")).put(release("0.18.0", prerelease = true))
            .put(release("0.17.3", "x86_64")).put(release("0.17.1")).put(release("0.17.2"))
        assertEquals("0.17.2", AppUpdatePolicy.offer(releases, "0.17.0", "arm64-v8a")?.version)
        assertNull(AppUpdatePolicy.offer(releases, "0.19.0", "arm64-v8a"))
        assertTrue(AppUpdatePolicy.newer("0.17.0", "0.16.10"))
        assertFalse(AppUpdatePolicy.newer("0.17.0-beta.1", "0.16.1"))
        assertFalse(AppUpdatePolicy.newer("99999999999999999.1.0", "0.16.1"))
    }
    @Test fun downloadUrlsAndChecksumsAreBoundToTheOfficialAsset() {
        assertTrue(AppUpdatePolicy.trustedUrl("https://github.com/Boringchen-10/genzo/releases/download/v0.17.0/Genzo.apk", true))
        for (url in listOf("http://github.com/Boringchen-10/genzo/releases/download/v1/a.apk", "https://github.com.evil.invalid/Boringchen-10/genzo/releases/download/v1/a.apk", "https://user@github.com/Boringchen-10/genzo/releases/download/v1/a.apk", "https://github.com/other/genzo/releases/download/v1/a.apk")) assertFalse(url, AppUpdatePolicy.trustedUrl(url, true))
        assertTrue(AppUpdatePolicy.trustedUrl("https://release-assets.githubusercontent.com/github-production-release-asset/a?token=opaque", false))
        assertFalse(AppUpdatePolicy.trustedUrl("https://example.com/update.apk", false))
        val hash = "b".repeat(64)
        assertEquals(hash, AppUpdatePolicy.checksum("$hash  other.apk\n$hash *Genzo.apk\n", "Genzo.apk"))
        assertNull(AppUpdatePolicy.checksum("$hash  Genzo.apk\n$hash  Genzo.apk", "Genzo.apk"))
        val unsafe = release("0.17.1")
        unsafe.getJSONArray("assets").getJSONObject(0).put("browser_download_url", "https://github.com/other/genzo/releases/download/v0.17.1/Genzo.apk")
        assertNull(AppUpdatePolicy.offer(JSONArray().put(unsafe), "0.17.0", "arm64-v8a"))
    }
    @Test fun renamedAssetsPreferYukiAndStillAcceptPublishedGenzoFiles() {
        val legacy = release("0.18.0")
        val renamed = release("0.18.0", brand = "Yuki")
        assertEquals("Genzo_0.18.0_android_arm64-v8a.apk", AppUpdatePolicy.offer(JSONArray().put(legacy), "0.17.1", "arm64-v8a")?.name)
        assertEquals("Yuki_0.18.0_android_arm64-v8a.apk", AppUpdatePolicy.offer(JSONArray().put(renamed), "0.17.1", "arm64-v8a")?.name)
        legacy.getJSONArray("assets").put(renamed.getJSONArray("assets").getJSONObject(0))
        assertEquals("Yuki_0.18.0_android_arm64-v8a.apk", AppUpdatePolicy.offer(JSONArray().put(legacy), "0.17.1", "arm64-v8a")?.name)
        val wrong = release("0.18.0", "x86_64", brand = "Yuki")
        assertNull(AppUpdatePolicy.offer(JSONArray().put(wrong), "0.17.1", "arm64-v8a"))
    }
    @Test fun identityRequiresTheSameApplicationAndSigningKeyAndAHigherCode() {
        AppUpdatePolicy.validateIdentity("com.genzo.android", 17001, setOf("key"), "com.genzo.android", 17000, setOf("key"))
        fun rejected(name: String, code: Long, keys: Set<String>) {
            try { AppUpdatePolicy.validateIdentity(name, code, keys, "com.genzo.android", 17000, setOf("key")); fail("must reject") }
            catch (_: IllegalArgumentException) { }
        }
        rejected("com.genzo.android.readerqa", 18000, setOf("key"))
        rejected("com.genzo.android", 17000, setOf("key"))
        rejected("com.genzo.android", 16000, setOf("key"))
        rejected("com.genzo.android", 18000, setOf("other"))
        rejected("com.genzo.android", 18000, emptySet())
    }
    @Test fun downloadNeverAcceptsTruncationExcessBytesOrTheWrongHash() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue(context.packageName.endsWith("qa"))
        val file = File.createTempFile("update-policy-", ".part", context.cacheDir)
        val bytes = ByteArray(8193) { (it % 251).toByte() }
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        try {
            var completed = 0L
            AppUpdatePolicy.copyVerified(ByteArrayInputStream(bytes), file, bytes.size.toLong(), hash) { completed = it }
            assertEquals(bytes.size.toLong(), completed)
            assertArrayEquals(bytes, file.readBytes())
            for ((size, digest) in listOf(bytes.size.toLong() + 1 to hash, bytes.size.toLong() - 1 to hash, bytes.size.toLong() to "0".repeat(64))) {
                try { AppUpdatePolicy.copyVerified(ByteArrayInputStream(bytes), file, size, digest) { }; fail("must reject") }
                catch (_: IllegalArgumentException) { }
            }
        } finally { file.delete() }
    }
}
