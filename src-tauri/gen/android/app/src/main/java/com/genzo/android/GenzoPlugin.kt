package com.genzo.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.os.CancellationSignal
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

@InvokeArg
class TreeArgs { var uri: String? = null; var rootUri: String? = null }
@InvokeArg
class PlayerArgs {
    var uri: String = ""
    var restart: Boolean = false
    var mediaFileId: String? = null
    var sessionId: String? = null
    var resumeMs: Long? = null
    var subtitleUri: String? = null
    var subtitleFile: String? = null
    var subtitleLabel: String? = null
    var subtitleId: String? = null
    var ruleOperation: Long = 0
    var loading: Boolean = false
    var loadingMessage: String = "正在准备视频…"
    var loadingError: Boolean = false
    var loadingErrorCode: String = "resolve_failed"
    var sourceKind: String = "rule"
}
@InvokeArg
class CredentialArgs { lateinit var id: String; var username: String = ""; var password: String = "" }
@InvokeArg
class ControlArgs {
    lateinit var action: String; var value: Double = 0.0; var uri: String? = null; var sessionId: String? = null; var trackId: String? = null
    var hardwareDecoding: Boolean = true; var hardwareDecoder: String = "auto-safe"; var videoRenderer: String = "auto"
}
@InvokeArg
class SessionArgs { lateinit var sessionId: String }
@InvokeArg
class PlayerFailureArgs { lateinit var sessionId: String; var code: String = "source_offline" }
@InvokeArg
class PlayerPageArgs { lateinit var sessionId: String; var requestId: Long = 0; var channel: String = "context"; var data: String = "{}" }
@InvokeArg
class PlaybackPreferencesArgs {
    var hardwareDecoding: Boolean = true; var hardwareDecoder: String = "auto-safe"
    var videoRenderer: String = "auto"; var superResolution: Int = 0
}
@InvokeArg
class AppearanceArgs { var dark: Boolean = true; var appearance: Map<String, Any?>? = null }
@InvokeArg
class ReaderArgs { lateinit var sessionId: String; lateinit var baseUrl: String; lateinit var kind: String; lateinit var entryId: String }
@InvokeArg
class ReaderControlArgs { lateinit var sessionId: String; lateinit var action: String; var value: Double = 0.0; var settings: String? = null }
@InvokeArg
class DataPackageArgs { lateinit var data: String }
@InvokeArg
class ImportServiceArgs { var text: String = "正在整理目录" }
@InvokeArg
class RuleArgs { var html: String = ""; var rule: String = "{}"; var operation: String = "search"; var resolveOperation: Long = 0; var url: String = ""; var legacy: Boolean = false; var method: String = "GET"; var body: String = "" }
@InvokeArg
class OfflineVideoArgs {
    lateinit var id: String; var uri: String = ""; var headers: HashMap<String, String> = hashMapOf(); var title: String = ""
    var mediaFileId: String? = null; var workId: String? = null; var episodeTitle: String? = null; var action: String = ""
    var recipe: Any? = null
    var forceRefresh: Boolean = false
}
@InvokeArg
class OfflinePrepareTicketArgs { lateinit var ticket: String; var id: String? = null }
@InvokeArg
class BookDownloadActivityArgs { var running: Boolean = false; var count: Int = 0 }
@InvokeArg
class OfflineFileArgs { lateinit var path: String; var mediaFileId: String? = null; var title: String? = null }

@TauriPlugin
class GenzoPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun getAppIcon(invoke: Invoke) {
        try { invoke.resolve(JSObject().put("id", LauncherIcons.current(activity))) }
        catch (_: Exception) { invoke.reject("无法读取应用图标，请重试") }
    }
    @Command
    fun setAppIcon(invoke: Invoke) {
        val args = invoke.parseArgs(AppIconArgs::class.java)
        activity.runOnUiThread {
            try { invoke.resolve(JSObject().put("id", LauncherIcons.select(activity, args.id))) }
            catch (_: Exception) { invoke.reject("图标切换失败，请重试") }
        }
    }
    @Command
    fun appUpdateStatus(invoke: Invoke) { invoke.resolve(AppUpdater.status(activity)) }
    @Command
    fun checkAppUpdate(invoke: Invoke) { invoke.resolve(AppUpdater.check(activity)) }
    @Command
    fun downloadAppUpdate(invoke: Invoke) { invoke.resolve(AppUpdater.download(activity)) }
    @Command
    fun cancelAppUpdate(invoke: Invoke) { invoke.resolve(AppUpdater.cancel(activity)) }
    @Command
    fun installAppUpdate(invoke: Invoke) { invoke.resolve(AppUpdater.install(activity)) }
    @Command
    fun openAppReleases(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppUpdatePolicy.RELEASE_PAGE)))
                invoke.resolve(AppUpdater.status(activity))
            } catch (_: Exception) { invoke.reject("无法打开浏览器，请手动访问 Yuki 的 GitHub 发布页") }
        }
    }
    @Command
    fun parseRuleHtml(invoke: Invoke) {
        val args = invoke.parseArgs(RuleArgs::class.java)
        worker.execute { try { invoke.resolve(JSObject(RuleHtml.parse(args.html, org.json.JSONObject(args.rule), args.operation).toString())) }
            catch (error: Exception) { invoke.resolve(JSObject().put("error", error.message?.take(160) ?: "规则 XPath 解析失败")) } }
    }
    @Command
    fun ruleEnvironment(invoke: Invoke) {
        val args = invoke.parseArgs(RuleArgs::class.java)
        activity.runOnUiThread { invoke.resolve(JSObject().put("userAgent", RuleResolver.USER_AGENT)
            .put("cookie", android.webkit.CookieManager.getInstance().getCookie(args.url) ?: "")) }
    }
    @Command
    fun resolveRuleVideo(invoke: Invoke) {
        val args = invoke.parseArgs(RuleArgs::class.java)
        RuleResolver.resolve(activity, args.url, args.legacy, args.resolveOperation) { invoke.resolve(JSObject(it.toString())) }
    }
    @Command
    fun resolveDownloadVideo(invoke: Invoke) {
        val args = invoke.parseArgs(RuleArgs::class.java)
        try { checkedHttpUri(args.url) } catch (_: Exception) { invoke.reject("invalid_download_source"); return }
        RuleResolver.resolveDownload(activity, args.url, args.legacy) { invoke.resolve(JSObject(it.toString())) }
    }
    @Command
    fun addOfflineVideo(invoke: Invoke) {
        val args = invoke.parseArgs(OfflineVideoArgs::class.java)
        activity.runOnUiThread {
            val downloads = try { OfflineVideoDownloads.get(activity) } catch (_: Exception) { invoke.reject("offline_download_storage_unavailable"); return@runOnUiThread }
            downloadPrepareWorker.execute { try {
                val prepared = prepareDownloadArgs(downloads, args)
                downloadControlWorker.execute { try {
                    val request = downloads.commit(prepared)
                    activity.runOnUiThread { try {
                        requestDownloadNotifications(); val state = downloads.add(request)
                        invoke.resolve(JSObject().put("id", request.id).put("state", state))
                    } catch (_: Exception) { invoke.reject("offline_download_service_unavailable") } }
                } catch (error: Exception) { invoke.reject(offlineErrorCode(error, "offline_download_prepare_failed")) } }
            } catch (error: Exception) { invoke.reject((error as? OfflineDownloadException)?.reason ?: "offline_download_prepare_failed") } }
        }
    }
    private fun prepareDownloadArgs(downloads: OfflineVideoDownloads, args: OfflineVideoArgs): OfflineVideoPreparation {
        val recipe = when (val raw = args.recipe) {
            is String -> org.json.JSONObject(raw)
            is Map<*, *> -> org.json.JSONObject(raw)
            null -> org.json.JSONObject()
            else -> throw IllegalArgumentException("invalid_download_recipe")
        }
        return downloads.prepare(args.id, args.uri, args.headers, args.title, args.mediaFileId, args.workId, args.episodeTitle, recipe, args.forceRefresh)
    }
    @Command
    fun prepareOfflineVideo(invoke: Invoke) {
        val args = invoke.parseArgs(OfflineVideoArgs::class.java)
        activity.runOnUiThread {
            val downloads = try { OfflineVideoDownloads.get(activity) } catch (_: Exception) { invoke.resolve(JSObject().put("errorCode", "offline_download_storage_unavailable")); return@runOnUiThread }
            downloadPrepareWorker.execute { try {
                val ticket = downloads.stage { prepareDownloadArgs(downloads, args) }
                invoke.resolve(JSObject().put("ticket", ticket))
            } catch (error: Exception) { invoke.resolve(JSObject().put("errorCode", offlineErrorCode(error, "offline_download_prepare_failed"))) } }
        }
    }
    @Command
    fun commitOfflineVideo(invoke: Invoke) {
        val args = invoke.parseArgs(OfflinePrepareTicketArgs::class.java)
        activity.runOnUiThread {
            val downloads = try { OfflineVideoDownloads.get(activity) } catch (_: Exception) { invoke.resolve(JSObject().put("errorCode", "offline_download_storage_unavailable")); return@runOnUiThread }
            downloadControlWorker.execute { try {
                val request = downloads.commitTicket(args.ticket, args.id)
                activity.runOnUiThread { try {
                    requestDownloadNotifications(); val state = downloads.add(request)
                    invoke.resolve(JSObject().put("id", request.id).put("state", state))
                } catch (_: Exception) { invoke.resolve(JSObject().put("errorCode", "offline_download_service_unavailable")) } }
            } catch (error: Exception) { invoke.resolve(JSObject().put("errorCode", offlineErrorCode(error, "offline_download_prepare_failed"))) } }
        }
    }
    @Command
    fun discardOfflineVideoPrepare(invoke: Invoke) {
        val args = invoke.parseArgs(OfflinePrepareTicketArgs::class.java)
        activity.runOnUiThread {
            try { OfflineVideoDownloads.get(activity).discard(args.ticket); invoke.resolve(JSObject().put("discarded", true)) }
            catch (_: Exception) { invoke.resolve(JSObject().put("errorCode", "offline_download_storage_unavailable")) }
        }
    }
    @Command
    fun listOfflineVideos(invoke: Invoke) {
        activity.runOnUiThread {
            val downloads = try { OfflineVideoDownloads.get(activity) } catch (_: Exception) { invoke.reject("offline_download_storage_unavailable"); return@runOnUiThread }
            val active = downloads.manager.currentDownloads.toList()
            downloadReadWorker.execute { try { invoke.resolve(JSObject().put("downloads", downloads.list(active))) }
                catch (_: Exception) { invoke.reject("offline_download_list_failed") } }
        }
    }
    @Command
    fun controlOfflineVideo(invoke: Invoke) {
        val args = invoke.parseArgs(OfflineVideoArgs::class.java)
        activity.runOnUiThread { try {
            if (args.action in listOf("resume", "retry")) requestDownloadNotifications()
            OfflineVideoDownloads.get(activity).control(args.id, args.action)
            invoke.resolve(JSObject().put("id", args.id).put("action", args.action))
        } catch (error: Exception) { invoke.reject((error as? OfflineDownloadException)?.reason ?: "offline_download_control_failed") } }
    }
    @Command
    fun offlineVideoLocator(invoke: Invoke) {
        val args = invoke.parseArgs(OfflineVideoArgs::class.java)
        activity.runOnUiThread {
            val downloads = try { OfflineVideoDownloads.get(activity) } catch (_: Exception) { invoke.reject("offline_download_storage_unavailable"); return@runOnUiThread }
            downloadReadWorker.execute { try { invoke.resolve(JSObject(downloads.locator(args.id).toString())) }
                catch (error: Exception) { invoke.reject((error as? OfflineDownloadException)?.reason ?: "offline_download_read_failed") } }
        }
    }
    @Command
    fun offlineFileLocator(invoke: Invoke) {
        val args = invoke.parseArgs(OfflineFileArgs::class.java)
        activity.runOnUiThread {
            val downloads = try { OfflineVideoDownloads.get(activity) } catch (_: Exception) { invoke.reject("offline_download_storage_unavailable"); return@runOnUiThread }
            downloadReadWorker.execute { try { invoke.resolve(JSObject().put("uri", downloads.fileLocator(args.path)).put("mediaFileId", args.mediaFileId).put("title", args.title)) }
                catch (_: Exception) { invoke.reject("offline_file_unavailable") } }
        }
    }
    @Command
    fun setBookDownloadActivity(invoke: Invoke) {
        val args = invoke.parseArgs(BookDownloadActivityArgs::class.java)
        activity.runOnUiThread { try {
            if (args.running) {
                requestDownloadNotifications()
                BookDownloadService.stopped = false
                androidx.core.content.ContextCompat.startForegroundService(activity, Intent(activity, BookDownloadService::class.java).putExtra("count", args.count))
            } else activity.stopService(Intent(activity, BookDownloadService::class.java))
            invoke.resolve(JSObject().put("running", args.running))
        } catch (_: Exception) { BookDownloadService.stopped = true; invoke.reject("book_download_service_unavailable") } }
    }
    @Command
    fun bookDownloadActivityState(invoke: Invoke) { invoke.resolve(JSObject().put("stopped", BookDownloadService.stopped)) }
    private var askedDownloadNotifications = false
    private fun requestDownloadNotifications() {
        if (!askedDownloadNotifications && android.os.Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            askedDownloadNotifications = true
            activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 5407)
        }
    }
    @Command
    fun cancelRuleVideo(invoke: Invoke) {
        val args = invoke.parseArgs(RuleArgs::class.java)
        RuleResolver.cancel(args.resolveOperation)
        activity.runOnUiThread { PlayerActivity.current?.get()?.cancelRuleLoading(args.resolveOperation); invoke.resolve() }
    }
    @Command
    fun verifyRuleSource(invoke: Invoke) {
        val args = invoke.parseArgs(RuleArgs::class.java)
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, RuleVerificationActivity::class.java).putExtra("url", args.url)
                .putExtra("method", args.method).putExtra("body", args.body).putExtra("config", args.rule))
            invoke.resolve()
        }
    }
    @Command
    fun startSourceImportService(invoke: Invoke) {
        activity.runOnUiThread { try {
            SourceImportService.stopped = false
            androidx.core.content.ContextCompat.startForegroundService(activity, Intent(activity, SourceImportService::class.java))
            invoke.resolve()
        } catch (_: Exception) { SourceImportService.stopped = true; invoke.reject("background_import_unavailable") } }
    }
    @Command
    fun updateSourceImportService(invoke: Invoke) {
        val args = invoke.parseArgs(ImportServiceArgs::class.java)
        activity.runOnUiThread { try {
            if (!SourceImportService.stopped) activity.startService(Intent(activity, SourceImportService::class.java).putExtra("text", args.text))
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("background_import_unavailable") } }
    }
    @Command
    fun stopSourceImportService(invoke: Invoke) {
        activity.runOnUiThread {
            activity.stopService(Intent(activity, SourceImportService::class.java)); invoke.resolve()
        }
    }
    @Command
    fun sourceImportServiceState(invoke: Invoke) {
        invoke.resolve(JSObject().put("stopped", SourceImportService.stopped))
    }
    @Command
    fun fingerprintDocument(invoke: Invoke) {
        val uri = Uri.parse(invoke.parseArgs(TreeArgs::class.java).uri)
        if (uri.scheme != "content") { invoke.reject("invalid_document"); return }
        worker.execute { try {
            fun attributes(): Pair<Long, Long> = requireNotNull(activity.contentResolver.query(uri,
                arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED),null,null,null)).use { cursor ->
                require(cursor.moveToFirst() && !cursor.isNull(0) && !cursor.isNull(1))
                Pair(cursor.getLong(0),cursor.getLong(1))
            }
            val before = attributes(); require(before.first > 0)
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            var size = 0L
            requireNotNull(activity.contentResolver.openInputStream(uri)).use { input ->
                val buffer = ByteArray(1024*1024)
                while (true) { val count=input.read(buffer); if (count<0) break; digest.update(buffer,0,count); size+=count }
            }
            require(attributes()==before && size==before.first)
            val hash=digest.digest().joinToString("") { "%02x".format(it) }
            invoke.resolve(JSObject().put("size",size).put("version","sha256:$hash:$size"))
        } catch (_:Exception) { invoke.reject("document_verification_failed"); } }
    }
    private var pendingDataPackage: ByteArray? = null
    @Command
    fun exportDataPackage(invoke: Invoke) {
        val data = invoke.parseArgs(DataPackageArgs::class.java).data.toByteArray(Charsets.UTF_8)
        if (data.size > 16 * 1024 * 1024 || pendingDataPackage != null) { invoke.reject("package_limit_or_busy"); return }
        pendingDataPackage = data
        startActivityForResult(invoke,Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_TITLE,"Yuki-personal-data.json"),"dataPackageSaved")
    }
    @ActivityCallback
    fun dataPackageSaved(invoke: Invoke,result: ActivityResult) {
        val bytes = pendingDataPackage; pendingDataPackage = null
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("status","cancelled")); return }
        if (bytes == null || uri.scheme != "content") { invoke.reject("invalid_package_target"); return }
        worker.execute { try {
            requireNotNull(activity.contentResolver.openOutputStream(uri,"wt")).use { it.write(bytes) }
            invoke.resolve(JSObject().put("status","saved"))
        } catch (_: Exception) { invoke.reject("package_write_failed") } }
    }
    @Command
    fun importDataPackage(invoke: Invoke) {
        startActivityForResult(invoke,Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),"dataPackageSelected")
    }
    @ActivityCallback
    fun dataPackageSelected(invoke: Invoke,result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("status","cancelled")); return }
        if (uri.scheme != "content") { invoke.reject("invalid_package_source"); return }
        worker.execute { try {
            val bytes = requireNotNull(activity.contentResolver.openInputStream(uri)).use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(32768)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    require(output.size()+count <= 16*1024*1024)
                    output.write(buffer,0,count)
                }
                output.toByteArray()
            }
            invoke.resolve(JSObject().put("status","selected").put("data",bytes.toString(Charsets.UTF_8)))
        } catch (_: Exception) { invoke.reject("package_read_failed") } }
    }
    private val preferences = activity.getSharedPreferences("genzo-prototype", 0)
    private val worker = Executors.newSingleThreadExecutor()
    private val downloadPrepareWorker = Executors.newSingleThreadExecutor()
    private val downloadControlWorker = Executors.newSingleThreadExecutor()
    private val downloadReadWorker = Executors.newSingleThreadExecutor()
    private val timeouts = Executors.newSingleThreadScheduledExecutor()
    private val credentials = CredentialStore(activity)

    @Command
    fun openReader(invoke: Invoke) {
        val args = invoke.parseArgs(ReaderArgs::class.java)
        val uri = Uri.parse(args.baseUrl)
        if (uri.scheme != "http" || uri.host != "127.0.0.1" || uri.port <= 0 || args.kind !in listOf("comic", "novel")) {
            invoke.reject("invalid_reader_session"); return
        }
        activity.startActivity(Intent(activity, ReaderActivity::class.java)
            .putExtra("baseUrl", args.baseUrl).putExtra("sessionId", args.sessionId)
            .putExtra("kind", args.kind).putExtra("entryId", args.entryId))
        invoke.resolve(JSObject().put("status", "opening"))
    }
    @Command
    fun openComicFixture(invoke:Invoke) {
        if(!BuildConfig.DEBUG||activity.packageName!="com.genzo.android.readerqa"){invoke.reject("qa_only");return}
        if(invoke.parseArgs(ReaderArgs::class.java).kind!="comic"){invoke.reject("comic_fixture_only");return}
        openReader(invoke)
    }
    @Command
    fun readerState(invoke: Invoke) {
        if (!BuildConfig.DEBUG || activity.packageName != "com.genzo.android.readerqa") { invoke.reject("qa_only"); return }
        activity.runOnUiThread {
            ReaderActivity.current?.get()?.report(ReaderActivity.snapshot.optString("status", "ready"))
            invoke.resolve(JSObject(ReaderActivity.snapshot.toString()))
        }
    }
    @Command
    fun readerControl(invoke: Invoke) {
        if (!BuildConfig.DEBUG || activity.packageName != "com.genzo.android.readerqa") { invoke.reject("qa_only"); return }
        val args = invoke.parseArgs(ReaderControlArgs::class.java)
        val reader = ReaderActivity.current?.get()
        if (reader == null || reader.intent.getStringExtra("sessionId") != args.sessionId) { invoke.reject("reader_session_expired"); return }
        activity.runOnUiThread { try { reader.qaControl(args.action, args.value, args.settings); invoke.resolve(JSObject(ReaderActivity.snapshot.toString())) }
            catch (_: Exception) { invoke.reject("invalid_reader_action") } }
    }

    @Command
    fun appearance(invoke: Invoke) {
        val args = invoke.parseArgs(AppearanceArgs::class.java)
        activity.runOnUiThread {
            try { PlayerAppearance.save(activity, args.dark, args.appearance?.let { org.json.JSONObject(it) }) }
            catch (_: Exception) { invoke.reject("invalid_player_appearance"); return@runOnUiThread }
            WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
                isAppearanceLightStatusBars = !args.dark
                isAppearanceLightNavigationBars = !args.dark
            }
            activity.window.decorView.setBackgroundColor(PlayerAppearance.read(activity).background)
            PlayerActivity.current?.get()?.applyAppearance()
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun safeArea(invoke: Invoke) {
        activity.runOnUiThread {
            val density = activity.resources.displayMetrics.density
            val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
            val bars = insets?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            invoke.resolve(JSObject().apply {
                put("top", ((bars?.top ?: 0) / density).toDouble())
                put("right", ((bars?.right ?: 0) / density).toDouble())
                put("bottom", ((bars?.bottom ?: 0) / density).toDouble())
                put("left", ((bars?.left ?: 0) / density).toDouble())
            })
        }
    }

    @Command
    fun saveCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        worker.execute { try { credentials.save(args.id, args.username, args.password); invoke.resolve(JSObject()) }
            catch (_: Exception) { invoke.reject("credential_storage_failed") } }
    }
    @Command
    fun readCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        worker.execute { try { invoke.resolve(JSObject(credentials.read(args.id).toString())) }
            catch (_: Exception) { invoke.reject("credential_invalid") } }
    }
    @Command
    fun deleteCredentials(invoke: Invoke) {
        val args = invoke.parseArgs(CredentialArgs::class.java)
        worker.execute { try { credentials.delete(args.id); invoke.resolve(JSObject()) }
            catch (_: Exception) { invoke.reject("credential_storage_failed") } }
    }

    @Command
    fun pickTree(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        startActivityForResult(invoke, intent, "treePicked")
    }

    @ActivityCallback
    fun treePicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("status", "cancelled")); return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            preferences.edit().putString("treeUri", uri.toString()).apply()
            invoke.resolve(JSObject().put("status", "authorized").put("uri", uri.toString()))
        } catch (_: SecurityException) {
            invoke.resolve(JSObject().put("status", "permission_denied"))
        }
    }

    @Command
    fun listTree(invoke: Invoke) {
        val args = invoke.parseArgs(TreeArgs::class.java)
        val storedUri = args.uri ?: preferences.getString("treeUri", null)
        if (storedUri == null) { invoke.resolve(JSObject().put("status", "not_authorized")); return }
        worker.execute {
            try {
                val tree = Uri.parse(storedUri)
                val treeId = DocumentsContract.getTreeDocumentId(tree)
                args.rootUri?.let { root ->
                    val allowed = Uri.parse(root)
                    if (tree.authority != allowed.authority || treeId != DocumentsContract.getTreeDocumentId(allowed)) {
                        throw SecurityException("Directory outside selected source")
                    }
                }
                if (activity.contentResolver.persistedUriPermissions.none { permission ->
                    permission.isReadPermission && permission.uri.authority == tree.authority &&
                        DocumentsContract.isTreeUri(permission.uri) && DocumentsContract.getTreeDocumentId(permission.uri) == treeId
                }) throw SecurityException("No persisted tree grant")
                val documentId = if (DocumentsContract.isDocumentUri(activity, tree)) DocumentsContract.getDocumentId(tree)
                    else treeId
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
                val files = JSArray()
                val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                val cancellation = CancellationSignal()
                val timeout = timeouts.schedule({ cancellation.cancel() }, 15, TimeUnit.SECONDS)
                var label: String? = null
                try {
                    val selected = DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
                    activity.contentResolver.query(selected, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                        null, null, null, cancellation)?.use { cursor -> if (cursor.moveToFirst()) label = cursor.getString(0) }
                    activity.contentResolver.query(children, projection, null, null, null, cancellation)?.use { cursor ->
                        while (cursor.moveToNext()) {
                            if (files.length() >= 200000) throw IllegalStateException("Directory too large")
                            files.put(JSObject().put("documentId", cursor.getString(0)).put("name", cursor.getString(1))
                                .put("mimeType", cursor.getString(2)).put("size", if (cursor.isNull(3)) org.json.JSONObject.NULL else cursor.getLong(3))
                                .put("modifiedMs", if (cursor.isNull(4)) org.json.JSONObject.NULL else cursor.getLong(4)).put("uri",
                                    DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0)).toString()))
                        }
                    } ?: throw IllegalStateException("Source unavailable")
                } finally { timeout.cancel(false) }
                invoke.resolve(JSObject().put("status", "available").put("uri", storedUri).put("label", label).put("files", files))
            } catch (_: SecurityException) {
                invoke.resolve(JSObject().put("status", "permission_denied"))
            } catch (_: Exception) {
                invoke.resolve(JSObject().put("status", "source_offline"))
            }
        }
    }

    @Command
    fun pickVideo(invoke: Invoke) {
        startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT).setType("video/*")
            .addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), "videoPicked")
    }

    @ActivityCallback
    fun videoPicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("status", "cancelled")); return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            invoke.resolve(JSObject().put("status", "authorized").put("uri", uri.toString()))
        } catch (_: SecurityException) { invoke.resolve(JSObject().put("status", "permission_denied")) }
    }

    @Command
    fun openPlayer(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerArgs::class.java)
        activity.runOnUiThread {
            if (args.ruleOperation > 0 && !RuleResolver.claim(args.ruleOperation)) { invoke.reject("播放解析已取消"); return@runOnUiThread }
            if (args.ruleOperation > 0 && !args.loading && args.sourceKind != "offline") {
                try { val current = PlayerActivity.current?.get() ?: error("expired_player_session"); current.acceptRuleMedia(args); invoke.resolve(JSObject().put("status", "opening")) }
                catch (_: Exception) { invoke.reject("播放解析已取消") }
                return@runOnUiThread
            }
            val uri = Uri.parse(args.uri)
            if (!args.loading && uri.scheme !in listOf("content", "https", "http")) { invoke.reject("Unsupported locator"); return@runOnUiThread }
            val landscape = PlayerActivity.current?.get()?.takeUnless { it.isFinishing || it.isDestroyed }?.resources?.configuration?.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            PlayerActivity.current?.get()?.closeForReplacement()
            activity.startActivity(Intent(activity, PlayerActivity::class.java).putExtra("uri", args.uri)
                .putExtra("sourceKind", args.sourceKind)
                .putExtra("landscape", landscape)
                .putExtra("ruleOperation", args.ruleOperation).putExtra("loading", args.loading).putExtra("loadingMessage", args.loadingMessage)
                .putExtra("restart", args.restart).putExtra("mediaFileId", args.mediaFileId)
                .putExtra("sessionId", args.sessionId).putExtra("resumeMs", args.resumeMs ?: -1L)
                .putExtra("subtitleUri", args.subtitleUri).putExtra("subtitleFile", args.subtitleFile)
                .putExtra("subtitleLabel", args.subtitleLabel).putExtra("subtitleId", args.subtitleId))
            if (PlayerMotion.enabled) activity.overridePendingTransition(R.anim.genzo_player_enter, R.anim.genzo_player_hold)
            invoke.resolve(JSObject().put("status", "opening"))
        }
    }

    @Command
    fun updateRulePlayer(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerArgs::class.java)
        activity.runOnUiThread {
            try { val current = PlayerActivity.current?.get() ?: error("expired_player_session"); current.updateRuleLoading(args); invoke.resolve() }
            catch (_: Exception) { invoke.reject("播放会话已结束") }
        }
    }

    @Command
    fun playerState(invoke: Invoke) { invoke.resolve(PlayerActivity.snapshot) }
    @Command
    fun takePlayerPageRequest(invoke: Invoke) {
        val args = invoke.parseArgs(SessionArgs::class.java)
        activity.runOnUiThread {
            val current = PlayerActivity.current?.get()
            val last = PlayerActivity.snapshot
            invoke.resolve(current?.takePageRequest(args.sessionId) ?: JSObject().put("closed", last.optString("sessionId") == args.sessionId && last.optString("status") == "closed"))
        }
    }
    @Command
    fun updatePlayerPage(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerPageArgs::class.java)
        activity.runOnUiThread { PlayerActivity.current?.get()?.updatePage(args); invoke.resolve() }
    }
    @Command
    fun playerSourceFailure(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerFailureArgs::class.java)
        activity.runOnUiThread {
            val prefs = activity.getSharedPreferences("genzo-player", 0)
            val saved = JSObject(prefs.getString("lastProgress", "{}")!!)
            if (saved.optString("sessionId") == args.sessionId) prefs.edit().putString("lastProgress", saved.put("failed", true).toString()).apply()
            val last = PlayerActivity.snapshot
            if (last.optString("sessionId") == args.sessionId && last.optString("status") == "closed") PlayerActivity.snapshot = JSObject(last.toString()).put("failed", true)
            invoke.resolve(JSObject().put("accepted", PlayerActivity.current?.get()?.sourceFailure(args.sessionId, args.code) ?: false))
        }
    }
    @Command
    fun savedPlayerProgress(invoke: Invoke) {
        invoke.resolve(JSObject(activity.getSharedPreferences("genzo-player", 0).getString("lastProgress", "{}")!!))
    }
    private fun playbackPreferences(): JSObject {
        val settings = PlaybackSettings.read(activity)
        return JSObject().put("hardwareDecoding", settings.hardware).put("hardwareDecoder", settings.decoder).put("videoRenderer", settings.renderer)
            .put("superResolution", activity.getSharedPreferences("genzo-player", 0).getInt("anime4kMode", 0).coerceIn(0, 2))
    }
    @Command
    fun getPlaybackPreferences(invoke: Invoke) { invoke.resolve(playbackPreferences()) }
    @Command
    fun setPlaybackPreferences(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackPreferencesArgs::class.java)
        try {
            PlaybackSettings(args.hardwareDecoding, args.hardwareDecoder, if (args.videoRenderer == "compat") "auto" else args.videoRenderer).save(activity, args.superResolution)
            invoke.resolve(playbackPreferences())
        } catch (_: Exception) { invoke.reject("播放设置无效，请检查解码、渲染与超分选项") }
    }
    @Command
    fun playerControl(invoke: Invoke) {
        val args = invoke.parseArgs(ControlArgs::class.java)
        activity.runOnUiThread {
            try {
                val current = PlayerActivity.current?.get()
                if (args.sessionId != null && current == null) { invoke.reject("expired_player_session"); return@runOnUiThread }
                invoke.resolve(current?.control(args) ?: JSObject().put("status", "closed"))
            } catch (_: Exception) { invoke.reject("invalid_player_control") }
        }
    }

    @Command
    fun pickSubtitle(invoke: Invoke) {
        val args = invoke.parseArgs(SessionArgs::class.java)
        activity.runOnUiThread {
            val current = PlayerActivity.current?.get()
            if (current == null) invoke.reject("expired_player_session")
            else current.pickSubtitle(invoke, args.sessionId)
        }
    }
}
