package com.genzo.android

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Only the separate test APK can launch this private Activity with synthetic data. */
@RunWith(AndroidJUnit4::class)
class ReaderCommentsLaunchTest {
    @Test fun syntheticReaderSession() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertEquals("com.genzo.android.organizeqa", context.packageName)
        val args = InstrumentationRegistry.getArguments()
        val base = requireNotNull(args.getString("baseUrl"))
        val uri = Uri.parse(base)
        require(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port > 0)
        val session = requireNotNull(args.getString("sessionId"))
        require(session.matches(Regex("[A-Za-z0-9-]{1,100}")))
        val entry = requireNotNull(args.getString("entryId"))
        java.util.UUID.fromString(entry)
        val done = File(context.cacheDir, "reader-comments-$session.done")
        done.delete()
        try {
            context.startActivity(Intent().setClassName(context.packageName, "com.genzo.android.ReaderActivity")
                .putExtra("baseUrl", base).putExtra("sessionId", session).putExtra("kind", "comic").putExtra("entryId", entry)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val deadline = SystemClock.elapsedRealtime() + 180_000
            while (!done.exists() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100)
            assertTrue("Synthetic UI driver did not finish in 180 seconds", done.exists())
        } finally {
            instrumentation.runOnMainSync {
                for (stage in listOf(Stage.RESUMED, Stage.STARTED, Stage.PAUSED, Stage.STOPPED)) {
                    ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage).toList()
                        .filter { it.javaClass.name == "com.genzo.android.ReaderActivity" }.forEach { it.finish() }
                }
            }
            done.delete()
        }
    }
}
