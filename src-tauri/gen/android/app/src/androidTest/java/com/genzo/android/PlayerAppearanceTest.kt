package com.genzo.android

import android.content.Context
import android.content.ComponentName
import android.content.pm.ActivityInfo
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PlayerAppearanceTest {
    private lateinit var context: Context
    private var original: Map<String, *> = emptyMap<String, Any>()
    private val light = JSONObject("""{"background":"#f6f8fa","raised":"#e2e6ea","surface":"#fdfefe","menu":"#ffffff","text":"#112233","muted":"#566778","accent":"#2468ac","accentInk":"#ffffff"}""")
    private val dark = JSONObject("""{"background":"#000000","raised":"#050607","surface":"#08090a","menu":"#000000","text":"#f4f7f6","muted":"#a8b0af","accent":"#65aaff","accentInk":"#07120e"}""")
    @Before fun before() {
        context = ApplicationProvider.getApplicationContext()
        assertEquals("com.genzo.android.organizeqa", context.packageName)
        original = context.getSharedPreferences("genzo-appearance", 0).all
    }
    @After fun after() {
        val edit = context.getSharedPreferences("genzo-appearance", 0).edit().clear()
        original.forEach { (key, value) -> if (value is String) edit.putString(key, value) }
        edit.commit()
    }
    private fun save(mode: String) = PlayerAppearance.save(context, mode != "light", JSONObject().put("mode", mode).put("light", light).put("dark", dark))
    private fun scene() = ActivityScenario.launch<PlayerActivity>(Intent(context, PlayerActivity::class.java).putExtra("loading", true).putExtra("sessionId", UUID.randomUUID().toString()))
    private fun panel(view: View): PlayerPage? {
        if (view is PlayerPage) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) panel(view.getChildAt(i))?.let { return it }
        return null
    }
    @Test fun explicitLightAndDarkMatchTheirSuppliedColorsWithoutRecreatingThePage() {
        save("light")
        scene().use { scene -> scene.onActivity { activity ->
            val page = requireNotNull(panel(activity.window.decorView))
            assertEquals(Color.parseColor("#f6f8fa"), (page.background as ColorDrawable).color)
            assertEquals(Color.parseColor("#2468ac"), page.accent)
            save("dark"); activity.applyAppearance()
            assertSame(page, panel(activity.window.decorView))
            assertEquals(Color.BLACK, (page.background as ColorDrawable).color)
            assertEquals(Color.parseColor("#65aaff"), page.accent)
        } }
        scene().use { scene -> scene.onActivity { activity ->
            assertEquals(Color.BLACK, (requireNotNull(panel(activity.window.decorView)).background as ColorDrawable).color)
        } }
    }
    @Test fun systemModeReadsBothPalettesAndExplicitModeOverridesOppositeSystemConfiguration() {
        val info = context.packageManager.getActivityInfo(ComponentName(context, PlayerActivity::class.java), 0)
        assertTrue(info.configChanges and ActivityInfo.CONFIG_UI_MODE != 0)
        val day = context.createConfigurationContext(Configuration(context.resources.configuration).apply { uiMode = uiMode and Configuration.UI_MODE_NIGHT_MASK.inv() or Configuration.UI_MODE_NIGHT_NO })
        val night = context.createConfigurationContext(Configuration(context.resources.configuration).apply { uiMode = uiMode and Configuration.UI_MODE_NIGHT_MASK.inv() or Configuration.UI_MODE_NIGHT_YES })
        save("system")
        assertFalse(PlayerAppearance.read(day).dark); assertTrue(PlayerAppearance.read(night).dark)
        assertEquals(Color.BLACK, PlayerAppearance.read(night).background)
        save("light"); assertFalse(PlayerAppearance.read(night).dark)
        assertEquals(Color.parseColor("#f6f8fa"), PlayerAppearance.read(night).background)
        save("dark"); assertTrue(PlayerAppearance.read(day).dark)
    }
    @Test fun popupSurfaceTextSelectedRowAndArrowUseTheCurrentPalette() {
        save("light")
        scene().use { scene -> scene.onActivity { activity ->
            val anchor = requireNotNull(panel(activity.window.decorView))
            val menu = PlayerSettingsMenu(anchor, listOf(PlayerMenuItem("速度", children = listOf(PlayerMenuItem("1.0×", selected = true))))) {}
            menu.show()
            val field = PlayerSettingsMenu::class.java.getDeclaredField("main").apply { isAccessible = true }
            val main = field.get(menu) as ScrollView
            assertEquals(Color.WHITE, (main.background as GradientDrawable).color!!.defaultColor)
            val column = main.getChildAt(0) as ViewGroup
            val header = (column.getChildAt(0) as ViewGroup).getChildAt(0) as TextView
            assertEquals(Color.parseColor("#112233"), header.currentTextColor)
            header.performClick()
            val options = (column.getChildAt(0) as ViewGroup).getChildAt(1) as ViewGroup
            assertEquals(Color.parseColor("#2468ac"), (options.getChildAt(0) as TextView).currentTextColor)
            menu.dismiss()
        } }
    }
}
