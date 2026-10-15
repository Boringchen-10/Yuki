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
        val night = when (prefs.getString("mode", "system")) {
            "dark" -> true
            "light" -> false
            else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        }
        val saved = runCatching { JSONObject(prefs.getString(if (night) "dark" else "light", "{}").orEmpty()) }.getOrDefault(JSONObject())
        fun color(name: String, fallback: String) = runCatching { Color.parseColor(saved.getString(name)) }.getOrElse { Color.parseColor(fallback) }
        return PlayerPalette(night, color("background", if (night) "#090d0f" else "#f3f6f5"), color("raised", if (night) "#151b18" else "#e3e9e6"),
            color("surface", if (night) "#18231e" else "#fafcfb"), color("menu", if (night) "#1c2922" else "#ffffff"),
            color("text", if (night) "#f4f7f6" else "#16201e"), color("muted", if (night) "#a8b0af" else "#53625e"),
            color("accent", if (night) "#4cc197" else "#237657"), color("accentInk", if (night) "#07120e" else "#ffffff"))
    }
}
