package com.genzo.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LauncherIconsTest {
    @Test fun switchingKeepsExactlyOneLaunchableEntryAndDoesNotDisableMainActivity() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        check(context.packageName == "com.genzo.android.iconqa") { "Only run against the isolated icon QA package" }
        val original = LauncherIcons.current(context)
        val manager = context.packageManager
        val main = android.content.ComponentName(context.packageName, "com.genzo.android.MainActivity")
        try {
            for (id in listOf("classic", "beret", "winter", "classic", "classic")) {
                assertEquals(id, LauncherIcons.select(context, id))
                assertEquals(id, LauncherIcons.current(context.applicationContext))
                val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
                val entries = manager.queryIntentActivities(intent, 0)
                assertEquals(1, entries.size)
                assertEquals("com.genzo.android.Launcher${id.replaceFirstChar { it.uppercase() }}", entries.single().activityInfo.name)
                assertNotNull(manager.getLaunchIntentForPackage(context.packageName))
                assertTrue(manager.getActivityInfo(main, 0).enabled)
                assertTrue(entries.single().loadIcon(manager) is android.graphics.drawable.AdaptiveIconDrawable)
            }
            try { LauncherIcons.select(context, "../invalid"); fail("Unknown icons must be rejected") }
            catch (_: IllegalArgumentException) { }
            assertEquals("classic", LauncherIcons.current(context))
        } finally { LauncherIcons.select(context, original) }
    }
}
