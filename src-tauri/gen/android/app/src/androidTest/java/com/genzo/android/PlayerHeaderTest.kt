package com.genzo.android

import android.content.Context
import android.content.Intent
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PlayerHeaderTest {
    @Test fun headerUsesVideoTopWithoutCutoutGapAndShowsTheOfficialEpisode() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        assertEquals("com.genzo.android.organizeqa",context.packageName)
        val session=UUID.randomUUID().toString()
        ActivityScenario.launch<PlayerActivity>(Intent(context,PlayerActivity::class.java).putExtra("loading",true).putExtra("sessionId",session)).use { scene ->
            Thread.sleep(250)
            scene.onActivity { activity ->
                fun field(name:String)=PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible=true }.get(activity)
                val viewport=field("viewport") as FrameLayout
                val chrome=field("chrome") as FrameLayout
                assertTrue(viewport.height>0);assertEquals(0,chrome.paddingTop)
                val videoPosition=IntArray(2);val headerPosition=IntArray(2)
                viewport.getLocationInWindow(videoPosition);chrome.getChildAt(0).getLocationInWindow(headerPosition)
                assertEquals(videoPosition[1],headerPosition[1])
                val page=field("page") as PlayerPage
                val request=requireNotNull(page.takeRequest())
                activity.updatePage(PlayerPageArgs().apply {
                    sessionId=session;requestId=request.getLong("id");channel="context"
                    data=JSONObject().put("title","尼古喵喵").put("playbackTitle","尼古喵喵 · 第01集").put("rows",JSONArray()).put("roads",JSONArray()).toString()
                })
                assertEquals("尼古喵喵 · 第01集",(field("titleView") as TextView).text.toString())
            }
        }
    }
}
