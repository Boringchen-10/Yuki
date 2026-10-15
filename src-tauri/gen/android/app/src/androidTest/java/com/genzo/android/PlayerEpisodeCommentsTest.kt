package com.genzo.android

import android.content.Context
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.ImageView
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.*
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.hamcrest.Matchers.containsString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PlayerEpisodeCommentsTest {
    private fun scenario(): ActivityScenario<PlayerActivity> {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertEquals("com.genzo.android.organizeqa", context.packageName)
        return ActivityScenario.launch(Intent(context, PlayerActivity::class.java).putExtra("loading", true).putExtra("sessionId", UUID.randomUUID().toString()))
    }
    private fun page(view: View): PlayerPage? {
        if (view is PlayerPage) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) page(view.getChildAt(i))?.let { return it }
        return null
    }
    private fun list(view: View): RecyclerView? {
        if (view is RecyclerView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) list(view.getChildAt(i))?.let { return it }
        return null
    }
    private fun context(id: String?, label: String) = JSONObject().put("title", "合成作品").put("rows", JSONArray()).put("roads", JSONArray())
        .put("hasBangumi", true).put("commentEpisodeId", id ?: JSONObject.NULL).put("commentEpisodeLabel", label)
    private fun response(body: String, reply: Boolean = false) = JSONObject().put("offset", 0).put("limit", 20).put("total", 1).put("items", JSONArray().put(
        JSONObject().put("id", body).put("userName", "合成楼主").put("createdAt", "2026-10-13").put("comment", body).put("floor", 7)
            .put("replies", if (reply) JSONArray().put(JSONObject().put("id", "reply").put("userName", "合成回复者").put("comment", "回复甲").put("createdAt", "2026-10-13")) else JSONArray())))
    private fun take(scenario: ActivityScenario<PlayerActivity>, page: PlayerPage): JSONObject {
        repeat(30) {
            var value: JSONObject? = null
            scenario.onActivity { value = page.takeRequest() }
            value?.let { return it }; Thread.sleep(50)
        }
        error("Native page did not produce a request")
    }
    @Test fun repliesOpenAndEpisodeChangeRejectsOldComments() {
        scenario().use { scene ->
            lateinit var panel: PlayerPage
            scene.onActivity { activity -> panel = requireNotNull(page(activity.window.decorView)); panel.accept("context", context("1212094", "第01集"), requireNotNull(panel.takeRequest()).getLong("id")) }
            onView(withText("评论")).perform(click())
            val request = take(scene, panel)
            scene.onActivity { panel.accept("comments", response("主楼甲", true), request.getLong("id")) }
            onView(withText("主楼甲")).check(matches(isDisplayed()))
            onView(withText("查看 1 条回复")).perform(click())
            onView(withText("回复甲")).check(matches(isDisplayed()))
            scene.onActivity { panel.loadContext(); panel.accept("context", context("1212095", "第02集"), requireNotNull(panel.takeRequest()).getLong("id")); panel.accept("comments", response("过期评论"), request.getLong("id")) }
            Thread.sleep(600)
            onView(withText("回复甲")).check(doesNotExist())
            onView(withText("过期评论")).check(doesNotExist())
            val next = take(scene, panel)
            scene.onActivity { panel.accept("comments", response("主楼乙"), next.getLong("id")) }
            onView(withText("主楼乙")).check(matches(isDisplayed()))
            onView(withText(containsString("第02集 · Bangumi 分集讨论"))).check(matches(isDisplayed()))
        }
    }
    @Test fun unmatchedFileShowsMappingHintWithoutFetchingAnotherEpisode() {
        scenario().use { scene ->
            lateinit var panel: PlayerPage
            scene.onActivity { activity -> panel=requireNotNull(page(activity.window.decorView)); panel.accept("context", context(null, ""), requireNotNull(panel.takeRequest()).getLong("id")) }
            onView(withText("评论")).perform(click()); Thread.sleep(350)
            onView(withText(containsString("未匹配 Bangumi 分集"))).check(matches(isDisplayed()))
            scene.onActivity { assertNull(panel.takeRequest()) }
        }
    }

    @Test fun suppliedPicturesRenderAndFailedPicturesRetryWithoutChangingTheComment() {
        fun pictures(view: View): List<ImageView> = when (view) {
            is ImageView -> if (view.contentDescription == "评论图片") listOf(view) else emptyList()
            is ViewGroup -> (0 until view.childCount).flatMap { pictures(view.getChildAt(it)) }
            else -> emptyList()
        }
        val qaContext = ApplicationProvider.getApplicationContext<Context>()
        val image = java.io.File(qaContext.cacheDir, "comment-picture-${UUID.randomUUID()}.png")
        val bitmap = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.GREEN) }
        image.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }; bitmap.recycle()
        try {
            scenario().use { scene ->
                lateinit var panel: PlayerPage
                scene.onActivity { activity -> panel = requireNotNull(page(activity.window.decorView)); panel.accept("context", context("1212094", "第01集"), requireNotNull(panel.takeRequest()).getLong("id")) }
                onView(withText("评论")).perform(click())
                val comments = take(scene, panel)
                scene.onActivity { panel.accept("comments", response("前文 [IMG=176,99] \n//i.postimg.cc/generated.png\n[/IMG] 后文"), comments.getLong("id")) }
                val first = take(scene, panel)
                assertEquals("commentImage", first.getString("action")); assertEquals("https://i.postimg.cc/generated.png", first.getString("url"))
                scene.onActivity { panel.accept("commentImage", JSONObject().put("error", ""), first.getLong("id")) }
                onView(withText("图片加载失败，点击重试")).perform(click())
                val retry = take(scene, panel); assertEquals(first.getString("url"), retry.getString("url"))
                scene.onActivity { panel.accept("commentImage", JSONObject().put("path", image.path), retry.getLong("id")) }
                var loaded = false
                repeat(30) {
                    scene.onActivity { loaded = pictures(panel).singleOrNull()?.drawable is BitmapDrawable }
                    if (!loaded) Thread.sleep(50)
                }
                assertTrue("Comment image did not decode", loaded)
                onView(withText("图片加载中…")).check(matches(withEffectiveVisibility(Visibility.GONE)))
                onView(withText("前文")).check(matches(isDisplayed())); onView(withText("后文")).check(matches(isDisplayed()))
            }
        } finally { image.delete() }
    }

    @Test fun scrollingAppendsCommentsAndFailureRetriesTheSameOffsetWithoutLooping() {
        fun comments(offset: Int, size: Int, total: Int) = JSONObject().put("offset", offset).put("limit", 20).put("total", total).put("items", JSONArray().apply {
            repeat(size) { index -> put(JSONObject().put("id", offset + index + 1).put("userName", "用户${offset + index}")
                .put("createdAt", "2026-10-13T07:00:00Z").put("comment", "第${offset + index}条合成评论\n用于滚动自动分页的正文。\n保留当前列表。")) }
        })
        scenario().use { scene ->
            lateinit var panel: PlayerPage
            scene.onActivity { activity -> panel=requireNotNull(page(activity.window.decorView)); panel.accept("context", context("1212094", "第01集"), requireNotNull(panel.takeRequest()).getLong("id")) }
            onView(withText("评论")).perform(click())
            val first=take(scene,panel)
            scene.onActivity { panel.accept("comments",comments(0,20,45),first.getLong("id")); requireNotNull(list(panel)).scrollToPosition(19) }
            val next=take(scene,panel); assertEquals("comments",next.getString("action")); assertEquals(20,next.getInt("offset"))
            scene.onActivity { panel.accept("comments",JSONObject().put("error","合成网络失败"),next.getLong("id")) }
            Thread.sleep(300)
            scene.onActivity { assertNull(panel.takeRequest()); assertEquals(20,requireNotNull(list(panel)).adapter!!.itemCount) }
            onView(withText("加载更多评论")).check(doesNotExist())
            onView(withText("重试")).perform(click())
            val retry=take(scene,panel); assertEquals(20,retry.getInt("offset"))
            scene.onActivity { panel.accept("comments",comments(20,20,45),retry.getLong("id")); requireNotNull(list(panel)).scrollToPosition(39) }
            val last=take(scene,panel); assertEquals(40,last.getInt("offset"))
            scene.onActivity { panel.accept("comments",comments(40,5,45),last.getLong("id")); requireNotNull(list(panel)).scrollToPosition(44) }
            Thread.sleep(200)
            scene.onActivity { assertEquals(45,requireNotNull(list(panel)).adapter!!.itemCount); assertNull(panel.takeRequest()) }
        }
    }

    @Test fun filePickerKeepsOnlyTheCurrentEpisodeAndRequestsTheChosenFileIdentity() {
        fun file(id:String,name:String,key:String,source:String,current:Boolean)=JSONObject().put("id",id).put("mediaFileId",id).put("fileName",name).put("title","官方分集")
            .put("episodeKey",key).put("label",if(key.endsWith("94")) "第01集" else "第02集").put("sourceId",source).put("sourceLabel",source).put("available",true).put("current",current)
        scenario().use { scene ->
            lateinit var panel:PlayerPage
            val local=file("local13","本地13.mkv","bangumi:1212094","local",true)
            val cloud=file("cloud13","云端13.mp4","bangumi:1212094","webdav",false)
            val next=file("next14","下一集14.mp4","bangumi:1212095","local",false)
            val data=context("1212094","第01集").put("selectedSource","local").put("rows",JSONArray().put(local).put(cloud).put(next)).put("fileChoices",JSONArray().put(local).put(cloud))
            scene.onActivity { activity -> panel=requireNotNull(page(activity.window.decorView)); panel.accept("context",data,requireNotNull(panel.takeRequest()).getLong("id")) }
            onView(withText(containsString("播放文件"))).perform(click())
            onView(withText("选择本集文件")).check(matches(isDisplayed()))
            onView(withText("下一集14.mp4")).check(doesNotExist())
            onView(withText("云端13.mp4")).perform(click())
            val play=take(scene,panel); assertEquals("play",play.getString("action")); assertEquals("cloud13",play.getString("target"))
        }
    }

    @Test fun rulePickerShowsOnlyRoadsAndTheirEpisodeCounts() {
        scenario().use { scene ->
            lateinit var panel:PlayerPage
            val rows=JSONArray()
            repeat(2) { road -> repeat(2) { index -> rows.put(JSONObject().put("id","rule:$road:$index").put("label","第0${index+1}集").put("sourceId","rule:$road")
                .put("sourceLabel",if(road==0) "线路一" else "线路二").put("ruleRoad",road).put("ruleIndex",index).put("current",road==0&&index==0).put("available",true)) } }
            val data=context(null,"").put("selectedSource","rule:0").put("rows",rows).put("roads",JSONArray().put(JSONObject().put("id","rule:0").put("label","线路一")).put(JSONObject().put("id","rule:1").put("label","线路二")))
            scene.onActivity { activity -> panel=requireNotNull(page(activity.window.decorView)); panel.accept("context",data,requireNotNull(panel.takeRequest()).getLong("id")) }
            onView(withText(containsString("播放线路"))).perform(click())
            onView(withText("选择播放线路")).check(matches(isDisplayed()))
            onView(withText("选择本集文件")).check(doesNotExist())
            onView(withText("线路二")).perform(click())
            onView(withText(containsString("播放线路  ·  线路二"))).check(matches(isDisplayed()))
        }
    }
}
