package com.genzo.android

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PlayerMotionTest {
    private fun scenario(): ActivityScenario<PlayerActivity> {
        assertEquals("com.genzo.android.organizeqa", BuildConfig.APPLICATION_ID)
        val context = ApplicationProvider.getApplicationContext<Context>()
        return ActivityScenario.launch(Intent(context, PlayerActivity::class.java).putExtra("loading", true).putExtra("sessionId", UUID.randomUUID().toString()))
    }
    private fun finishDelay(): Long {
        val context = ApplicationProvider.getApplicationContext<Context>()
        return (350 * java.lang.Math.max(1f, Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f))).toLong() + 100
    }
    @Test fun controlsFadeThroughIntermediateAlphaThenHide() {
        scenario().use { scenario ->
            lateinit var view: View
            var enabled = false
            scenario.onActivity { activity ->
                view = View(activity).apply { setBackgroundColor(0xff4cc197.toInt()) }
                activity.findViewById<FrameLayout>(android.R.id.content).addView(view, FrameLayout.LayoutParams(100, 100))
                enabled = PlayerMotion.enabled; PlayerMotion.visibility(view, false)
            }
            Thread.sleep(70)
            if (enabled) scenario.onActivity { assertTrue("fade should have intermediate alpha", view.alpha > 0f && view.alpha < 1f) }
            Thread.sleep(finishDelay())
            scenario.onActivity { assertEquals(View.GONE, view.visibility) }
        }
    }
    @Test fun rapidTabChangesKeepTheLastContentAndResetTranslation() {
        scenario().use { scenario ->
            lateinit var view: View
            var selected = 0
            scenario.onActivity { activity ->
                view = View(activity)
                activity.findViewById<FrameLayout>(android.R.id.content).addView(view, FrameLayout.LayoutParams(100, 100))
                PlayerMotion.swap(view) { selected = 1 }
                PlayerMotion.swap(view) { selected = 2 }
            }
            Thread.sleep(finishDelay())
            scenario.onActivity { assertEquals(2, selected); assertEquals(1f, view.alpha, .01f); assertEquals(0f, view.translationY, .01f) }
        }
    }
    @Test fun selectionColorAnimatesToTheRequestedColor() {
        scenario().use { scenario ->
            lateinit var view: TextView
            val target = 0xff4cc197.toInt()
            scenario.onActivity { activity ->
                view = TextView(activity).apply { text = "选集"; setTextColor(0xff8f9e96.toInt()) }
                activity.findViewById<FrameLayout>(android.R.id.content).addView(view, FrameLayout.LayoutParams(100, 100))
                PlayerMotion.color(view, target)
            }
            Thread.sleep(finishDelay())
            scenario.onActivity { assertEquals(target, view.currentTextColor) }
        }
    }
}
