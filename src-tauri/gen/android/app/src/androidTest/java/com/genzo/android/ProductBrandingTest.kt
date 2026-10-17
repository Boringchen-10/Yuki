package com.genzo.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProductBrandingTest {
    @Test fun newNameKeepsAllThreeExistingLauncherComponents() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        check(context.packageName == "com.genzo.android.renameqa")
        val manager = context.packageManager
        assertEquals("Yuki", manager.getApplicationLabel(context.applicationInfo).toString())
        for (name in listOf("LauncherClassic", "LauncherBeret", "LauncherWinter")) {
            val component = manager.getActivityInfo(ComponentName(context.packageName, "com.genzo.android.$name"), PackageManager.MATCH_DISABLED_COMPONENTS)
            assertEquals("Yuki", component.loadLabel(manager).toString())
            assertEquals("com.genzo.android.MainActivity", component.targetActivity)
        }
        val entries = manager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName), 0)
        assertEquals(1, entries.size)
        assertEquals("com.genzo.android.LauncherClassic", entries.single().activityInfo.name)
        assertEquals("classic", LauncherIcons.current(context))
    }
}
