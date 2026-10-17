package com.genzo.android

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/** The enabled launcher alias is the source of truth, including after upgrades. */
object LauncherIcons {
    private val aliases = linkedMapOf(
        "classic" to "com.genzo.android.LauncherClassic",
        "beret" to "com.genzo.android.LauncherBeret",
        "winter" to "com.genzo.android.LauncherWinter",
    )

    private fun component(context: Context, id: String) = ComponentName(context.packageName, aliases.getValue(id))

    @Synchronized
    fun current(context: Context): String = aliases.keys.firstOrNull { id ->
        when (context.packageManager.getComponentEnabledSetting(component(context, id))) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> id == "classic"
            else -> false
        }
    } ?: error("桌面图标入口不可用")

    @Synchronized
    fun select(context: Context, id: String): String {
        require(aliases.containsKey(id)) { "未知应用图标" }
        val manager = context.packageManager
        val ordered = listOf(id) + aliases.keys.filter { it != id }
        fun state(key: String) = if (key == id) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        if (Build.VERSION.SDK_INT >= 33) {
            manager.setComponentEnabledSettings(ordered.map { key ->
                PackageManager.ComponentEnabledSetting(component(context, key), state(key), PackageManager.DONT_KILL_APP)
            })
        } else {
            // Enable the new entry first so older systems never lose all launchers.
            val previous = current(context)
            try {
                for (key in ordered) manager.setComponentEnabledSetting(component(context, key), state(key), PackageManager.DONT_KILL_APP)
            } catch (error: Exception) {
                runCatching {
                    manager.setComponentEnabledSetting(component(context, previous), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
                    for (key in aliases.keys.filter { it != previous }) manager.setComponentEnabledSetting(component(context, key), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
                }
                throw error
            }
        }
        return current(context)
    }
}
