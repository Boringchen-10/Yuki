package com.genzo.android

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.UiController
import androidx.test.espresso.ViewAction
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.*
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.hamcrest.Matcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Synthetic loopback data only; never reads the user's library or sources. */
@RunWith(AndroidJUnit4::class)
class ReaderChapterCommentsTest {
    private val chapter = UUID.randomUUID().toString()
    private val second = UUID.randomUUID().toString()
    private fun until(label: String, test: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (!test() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50)
        assertTrue(label, test())
    }
    private fun scenario(fixture: Fixture): ActivityScenario<ReaderActivity> {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertEquals("com.genzo.android.organizeqa", context.packageName)
        return ActivityScenario.launch(Intent(context, ReaderActivity::class.java).putExtra("kind", "comic")
            .putExtra("entryId", chapter).putExtra("baseUrl", fixture.base).putExtra("sessionId", UUID.randomUUID().toString()))
    }
    private fun scrollToEnd() = onView(isAssignableFrom(RecyclerView::class.java)).perform(object : ViewAction {
        override fun getConstraints(): Matcher<View> = isAssignableFrom(RecyclerView::class.java)
        override fun getDescription() = "Scroll synthetic chapter comments to the last loaded row"
        override fun perform(controller: UiController, view: View) {
            val list = view as RecyclerView
            list.scrollBy(0, list.height * 20)
            controller.loopMainThreadUntilIdle()
        }
    })
    private fun itemCount(expected: Int) = onView(isAssignableFrom(RecyclerView::class.java)).check { view, error ->
        if (error != null) throw error
        assertEquals(expected, requireNotNull((view as RecyclerView).adapter).itemCount)
    }
    private fun awaitText(value: String) = until(value) { runCatching { onView(withText(value)).check(matches(isDisplayed())) }.isSuccess }
    private fun awaitCount(expected: Int) = until("$expected comments") { runCatching { itemCount(expected) }.isSuccess }

    @Test fun scrollingLoadsPagesAndFailedAppendRequiresRetryAtTheSameOffset() {
        Fixture().use { fixture -> scenario(fixture).use { scene ->
            lateinit var panel: ReaderChapterComments
            scene.onActivity { panel = ReaderChapterComments(it); panel.show(chapter, "合成甲话") }
            until("first page") { fixture.offsets == listOf(0) }
            awaitText("合成甲评论01")
            onView(withText("加载更多评论")).check(doesNotExist())
            until("avatar must use the actual comment ID") { fixture.paths.any { it.endsWith("comment-avatar/1") } }
            scrollToEnd()
            until("append request") { fixture.offsets == listOf(0, 30) }
            awaitText("本话评论读取失败，请检查阅读网络设置后重试。")
            itemCount(30)
            scrollToEnd(); SystemClock.sleep(300)
            assertEquals(listOf(0, 30), fixture.offsets)
            onView(withText("重试")).perform(click())
            until("same offset retry") { fixture.offsets == listOf(0, 30, 30) }
            awaitCount(60)
            scrollToEnd()
            until("last page") { fixture.offsets == listOf(0, 30, 30, 60) }
            awaitCount(65)
            onView(withText("加载更多评论")).check(doesNotExist())
            scrollToEnd(); SystemClock.sleep(300)
            assertEquals(listOf(0, 30, 30, 60), fixture.offsets)
            scene.onActivity { panel.close() }
        } }
    }

    @Test fun closingCancelsAvatarJobsAndLateImagesCannotEnterAnotherChapter() {
        Fixture(holdAvatar = true).use { fixture -> scenario(fixture).use { scene ->
            lateinit var panel: ReaderChapterComments
            scene.onActivity { panel = ReaderChapterComments(it); panel.show(chapter, "合成甲话") }
            until("pending avatar") { fixture.paths.any { it.endsWith("comment-avatar/1") } }
            val jobsField = ReaderChapterComments::class.java.getDeclaredField("avatarJobs").apply { isAccessible = true }
            scene.onActivity {
                assertTrue((jobsField.get(panel) as Map<*, *>).isNotEmpty())
                panel.close()
                assertTrue((jobsField.get(panel) as Map<*, *>).isEmpty())
                panel.show(second, "合成乙话")
            }
            fixture.avatarRelease.countDown()
            awaitText("合成乙评论01")
            SystemClock.sleep(350)
            onView(withText("合成甲评论01")).check(doesNotExist())
            onView(withText("合成乙评论01")).check(matches(isDisplayed()))
            scene.onActivity { panel.close() }
        } }
    }

    private inner class Fixture(holdAvatar: Boolean = false) : AutoCloseable {
        private val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        private val workers = Executors.newCachedThreadPool { task -> Thread(task, "chapter-comments-fixture").apply { isDaemon = true } }
        val base = "http://127.0.0.1:${server.localPort}/${UUID.randomUUID()}/"
        val paths = CopyOnWriteArrayList<String>()
        val offsets = CopyOnWriteArrayList<Int>()
        val avatarRelease = CountDownLatch(if (holdAvatar) 1 else 0)
        private var failAppend = true
        init { workers.execute {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                workers.execute { runCatching { socket.use {
                    val input = socket.getInputStream().bufferedReader()
                    val request = input.readLine() ?: return@use
                    while (!input.readLine().isNullOrEmpty()) { }
                    val path = request.split(' ')[1].substringBefore('?').removePrefix(java.net.URI(base).path)
                    paths.add(path)
                    val parts = path.split('/')
                    var status = 200
                    val image = parts.size == 4 && parts[2] == "comment-avatar"
                    val body = when {
                        image -> { avatarRelease.await(15, TimeUnit.SECONDS); android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQmcAAAAASUVORK5CYII=", android.util.Base64.DEFAULT) }
                        parts.size == 4 && parts[2] == "comments" -> {
                            val offset = parts[3].toInt(); val isFirst = parts[1] == chapter
                            if (isFirst) offsets.add(offset)
                            if (isFirst && offset == 30 && failAppend) { failAppend = false; status = 503; "{\"error\":\"synthetic append failure\"}".toByteArray() }
                            else {
                                val total = if (isFirst) 65 else 1
                                val items = JSONArray()
                                for (index in offset until minOf(offset + 30, total)) items.put(JSONObject()
                                    .put("id", (index + 1).toString()).put("userName", "合成用户${index + 1}")
                                    .put("createAt", Instant.now().minusSeconds(5 * 86400).toString())
                                    .put("userAvatar", if (isFirst && index == 0) "https://s3.mangafunb.fun/qa-avatar.png" else "")
                                    .put("comment", "合成${if (isFirst) "甲" else "乙"}评论${(index + 1).toString().padStart(2, '0')}"))
                                JSONObject().put("items", items).put("total", total).put("offset", offset).put("limit", 30).toString().toByteArray()
                            }
                        }
                        parts.size == 2 && parts[0] == "chapter" -> { status = 503; "{\"error\":\"Synthetic reader shell\"}".toByteArray() }
                        else -> "{}".toByteArray()
                    }
                    val header = "HTTP/1.1 $status Test\r\nContent-Type: ${if (image) "image/png" else "application/json; charset=utf-8"}\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                    socket.getOutputStream().apply { write(header.toByteArray()); write(body); flush() }
                } } }
            }
        } }
        override fun close() { avatarRelease.countDown(); server.close(); workers.shutdownNow() }
    }
}
