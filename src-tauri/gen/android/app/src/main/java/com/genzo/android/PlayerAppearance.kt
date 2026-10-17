package com.genzo.android

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.view.ContextThemeWrapper
import androidx.core.graphics.ColorUtils
import org.json.JSONObject

internal data class PlayerPalette(val dark: Boolean, val background: Int, val raised: Int, val surface: Int, val menu: Int,
    val text: Int, val muted: Int, val accent: Int, val accentInk: Int) {
    val selected get() = ColorUtils.blendARGB(menu, accent, .14f)
    val ripple get() = ColorUtils.setAlphaComponent(accent, 48)
    fun themed(context: Context) = ContextThemeWrapper(context, if (dark) R.style.Theme_Genzo_Player_Dark else R.style.Theme_Genzo_Player_Light)
}

/** The WebView supplies both actual CSS palettes, so system changes work even while it is backgrounded. */
internal object PlayerAppearance {
    private const val STORE = "genzo-appearance"
    fun save(context: Context, dark: Boolean, value: JSONObject?) {
        val mode = value?.optString("mode") ?: if (dark) "dark" else "light"
        require(mode in listOf("system", "dark", "light"))
        val edit = context.getSharedPreferences(STORE, 0).edit().putString("mode", mode)
        if (value != null) {
            for (name in listOf("light", "dark")) {
                val colors = value.getJSONObject(name)
                listOf("background", "raised", "surface", "menu", "text", "muted", "accent", "accentInk").forEach { Color.parseColor(colors.getString(it)) }
                edit.putString(name, colors.toString())
            }
        }
        edit.apply()
    }
    fun read(context: Context): PlayerPalette {
        val prefs = context.getSharedPreferences(STORE, 0)
        val night = when (prefs.getString("mode", "light")) {
            "dark" -> true
            "light" -> false
            else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        }
        val saved = runCatching { JSONObject(prefs.getString(if (night) "dark" else "light", "{}").orEmpty()) }.getOrDefault(JSONObject())
        fun color(name: String, fallback: String) = runCatching { Color.parseColor(saved.getString(name)) }.getOrElse { Color.parseColor(fallback) }
        return PlayerPalette(night, color("background", if (night) "#090d10" else "#f2f5f8"), color("raised", if (night) "#11171d" else "#e3e8ed"),
            color("surface", if (night) "#13191f" else "#fcfdfe"), color("menu", if (night) "#131a20" else "#ffffff"),
            color("text", if (night) "#f2f5f8" else "#1b2937"), color("muted", if (night) "#a9b8c6" else "#495c6e"),
            color("accent", if (night) "#6ba3db" else "#205283"), color("accentInk", if (night) "#0b1a28" else "#ffffff"))
    }
}
