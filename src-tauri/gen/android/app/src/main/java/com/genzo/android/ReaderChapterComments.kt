package com.genzo.android

import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import java.io.File
import org.json.JSONObject

/** Chapter identity comes from the visible comic, scoped by the private reader session. */
class ReaderChapterComments(private val reader: ReaderActivity) {
    private class Feed {
        val items = mutableListOf<JSONObject>()
        var total = 0
        var offset = 0
        var loaded = false
    }
    private val cache = linkedMapOf<String, Feed>()
    private var dialog: BottomSheetDialog? = null
    private var request: Job? = null
    private var generation = 0
    private val avatarSlots = Semaphore(2)
    private val avatarJobs = mutableMapOf<ImageView, Job>()

    private fun cancelAvatars(view: View) {
        if (view is ImageView) avatarJobs.remove(view)?.cancel()
        if (view is ViewGroup) for (index in 0 until view.childCount) cancelAvatars(view.getChildAt(index))
    }
    private fun cancelAvatarJobs() { avatarJobs.values.toList().forEach { it.cancel() }; avatarJobs.clear() }

    fun show(chapter: String, title: String) {
        if (dialog?.isShowing == true) return
        val sequence = ++generation
        val feed = cache.remove(chapter) ?: Feed()
        cache[chapter] = feed
        while (cache.size > 3) cache.remove(cache.keys.first())
        var loading = false
        var error = false
        val sheet = BottomSheetDialog(reader)
        dialog = sheet
        sheet.setDismissWithAnimation(PlayerMotion.enabled)
        val column = LinearLayout(reader).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(reader.dp(18), reader.dp(10), reader.dp(18), reader.dp(20))
            setBackgroundColor(reader.readerBackground)
        }
        fun text(value: String, size: Float) = TextView(reader).apply {
            text = value; textSize = size; setTextColor(reader.readerForeground)
            setPadding(0, reader.dp(5), 0, reader.dp(5))
        }
        val header = LinearLayout(reader).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(text("本话评论", 18f).apply { setTypeface(typeface, Typeface.BOLD) }, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(reader.button("关闭") { sheet.dismiss() })
        column.addView(header)
        column.addView(text(title, 14f).apply { setTextColor(reader.mutedForeground); maxLines = 2 })
        val count = text("", 12f).apply { setTextColor(reader.mutedForeground) }
        column.addView(count)
        val message = text("", 13f)
        val retry = reader.button("重试") {}
        val layout = LinearLayoutManager(reader)
        val list = RecyclerView(reader).apply { layoutManager = layout }
        val views = CommentViews(reader, reader.readerForeground, reader.mutedForeground) { view, url, width ->
            val id = feed.items.firstOrNull { it.optString("userAvatar") == url }?.optString("id")
            if (!id.isNullOrEmpty()) {
                avatarJobs.remove(view)?.cancel()
                val job = reader.lifecycleScope.launch(start = CoroutineStart.LAZY) {
                    try {
                        val bitmap = avatarSlots.withPermit { withContext(Dispatchers.IO) {
                            val file = reader.client.image("chapter/$chapter/comment-avatar/$id", File(reader.cacheDir, "comment-avatars"))
                            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(file.path, bounds)
                            val options = BitmapFactory.Options().apply { inSampleSize = CommentImageSampling.sample(bounds.outWidth, bounds.outHeight, width * 2, width * 2, 65_536) }
                            BitmapFactory.decodeFile(file.path, options)
                        } }
                        if (sequence == generation && avatarJobs[view] === coroutineContext[Job] && bitmap != null) view.setImageBitmap(bitmap)
                    } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Keep the initial when the avatar is unavailable. */ }
                    finally { if (avatarJobs[view] === coroutineContext[Job]) avatarJobs.remove(view) }
                }
                avatarJobs[view] = job
                job.start()
            }
        }
        val adapter = object : RecyclerView.Adapter<CommentHolder>() {
            override fun getItemCount() = feed.items.size
            override fun onCreateViewHolder(parent: ViewGroup, type: Int): CommentHolder {
                val row = LinearLayout(reader).apply { orientation = LinearLayout.VERTICAL; setPadding(reader.dp(12), reader.dp(12), reader.dp(12), reader.dp(12))
                    background = GradientDrawable().apply { setColor(reader.hairlineColor); cornerRadius = reader.dp(18).toFloat() } }
                row.layoutParams = RecyclerView.LayoutParams(-1, -2).apply { bottomMargin = reader.dp(10) }
                return CommentHolder(row)
            }
            override fun onBindViewHolder(holder: CommentHolder, index: Int) {
                val item = feed.items[index]
                cancelAvatars(holder.row)
                holder.row.removeAllViews()
                val identity = views.identity(item, "createAt", true)
                holder.row.addView(identity)
                holder.row.addView(text(item.optString("comment"), 14f).apply { setTextIsSelectable(true) })
            }
            override fun onViewRecycled(holder: CommentHolder) { cancelAvatars(holder.row); super.onViewRecycled(holder) }
        }
        list.adapter = adapter; column.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
        column.addView(message); column.addView(retry)
        fun render() {
            count.text = if (feed.loaded) "${feed.total} 条评论 · 来源暂未提供本话热度" else "拷贝漫画每话评论"
            message.text = when { loading -> "正在读取本话评论…"; error -> "本话评论读取失败，请检查阅读网络设置后重试。"; feed.items.isEmpty() && feed.loaded -> "本话暂无评论"; else -> "" }
            message.visibility = if (message.text.isBlank()) View.GONE else View.VISIBLE
            retry.visibility = if (error) View.VISIBLE else View.GONE
            adapter.notifyDataSetChanged()
        }
        fun load() {
            if (loading) return
            loading = true; error = false; render()
            request = reader.lifecycleScope.launch {
                try {
                    val page = reader.client.json("chapter/$chapter/comments/${feed.offset}")
                    if (sequence != generation) return@launch
                    val items = page.getJSONArray("items")
                    val offset = page.getInt("offset")
                    check(offset == feed.offset)
                    val total = page.getInt("total")
                    check(items.length() > 0 || offset >= total)
                    val existing = feed.items.map { it.getString("id") }.toMutableSet()
                    for (index in 0 until items.length()) {
                        val item = items.getJSONObject(index)
                        if (existing.add(item.getString("id"))) feed.items.add(item)
                    }
                    feed.offset = offset + page.getInt("limit"); feed.total = total; feed.loaded = true
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { if (sequence == generation) error = true }
                finally { if (sequence == generation) { loading = false; render() } }
            }
        }
        fun moreIfNeeded() {
            if (sequence == generation && feed.loaded && !loading && !error && feed.offset < feed.total && layout.findLastVisibleItemPosition() >= feed.items.size - 4) load()
        }
        list.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(view: RecyclerView, dx: Int, dy: Int) { if (dy > 0) list.post { moreIfNeeded() } }
        })
        list.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> list.post { moreIfNeeded() } }
        retry.setOnClickListener { load() }
        sheet.setContentView(column, LinearLayout.LayoutParams(-1, (reader.resources.displayMetrics.heightPixels * 0.75f).toInt()))
        sheet.setOnDismissListener {
            if (sequence == generation) { generation++; request?.cancel(); request = null; cancelAvatarJobs(); list.adapter = null; dialog = null; if (feed.items.size > 200) cache.remove(chapter) }
        }
        sheet.show()
        sheet.behavior.apply { state = com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED; skipCollapsed = true }
        render(); if (!feed.loaded) load()
    }
    fun close() { generation++; request?.cancel(); request = null; cancelAvatarJobs(); dialog?.dismiss(); dialog = null; cache.clear() }
    private class CommentHolder(val row: LinearLayout) : RecyclerView.ViewHolder(row)
}
