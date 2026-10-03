package com.seatplanner.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.view.updateLayoutParams
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import org.json.JSONException
import org.json.JSONObject

/**
 * The app: the Seat Planner website, full screen.
 *
 * Pages always come from the server, so every web deploy is on the phone the
 * next time a page loads — the app itself only changes when this code does.
 * What a browser tab would give for free is filled in here: the back button,
 * pull to refresh, the camera for the ticket checker, the tickets PDF, and
 * links to other sites opening in the browser.
 *
 * The server is production unless a developer has switched it (see
 * ServerActivity); while it is not, a strip across the top says so.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var store: ServerStore
    private lateinit var web: WebView
    private lateinit var refresher: SwipeRefreshLayout
    private lateinit var progress: LinearProgressIndicator
    private lateinit var devStrip: TextView
    private lateinit var errorPanel: View
    private lateinit var errorTitle: TextView
    private lateinit var errorText: TextView
    private lateinit var errorDetail: TextView
    private lateinit var errorProduction: Button
    private lateinit var errorSettings: Button
    private lateinit var hold: ThreeFingerHold

    /** The server [web] is showing; compared on resume to pick up a switch. */
    private var showing: String? = null
    private var mainFrameFailed = false
    private var clearHistoryOnLoad = false
    private var pausedAt = 0L
    private var pullGuard: ScriptHandler? = null

    /** Set by the page as each touch starts — see [PageScripts.PULL_GUARD]. */
    private var pullBlocked = false

    /** A camera request from the page, waiting on Android's permission prompt. */
    private var pendingCamera: PermissionRequest? = null

    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingCamera ?: return@registerForActivityResult
            pendingCamera = null
            if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        store = ServerStore(this)
        web = findViewById(R.id.web)
        refresher = findViewById(R.id.refresher)
        progress = findViewById(R.id.progress)
        devStrip = findViewById(R.id.dev_strip)
        errorPanel = findViewById(R.id.error_panel)
        errorTitle = findViewById(R.id.error_title)
        errorText = findViewById(R.id.error_text)
        errorDetail = findViewById(R.id.error_detail)
        errorProduction = findViewById(R.id.error_production)
        errorSettings = findViewById(R.id.error_settings)
        hold = ThreeFingerHold(this) {
            window.decorView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            openServerScreen()
        }

        fitToSystemBars()
        setUpWebView()

        refresher.setColorSchemeColors(ContextCompat.getColor(this, R.color.brand))
        refresher.setOnChildScrollUpCallback { _, _ -> pullBlocked || web.scrollY > 0 }
        refresher.setOnRefreshListener {
            hideError()
            web.reload()
        }

        devStrip.setOnClickListener { confirmProduction() }
        findViewById<Button>(R.id.error_retry).setOnClickListener {
            hideError()
            web.reload()
        }
        errorProduction.setOnClickListener { confirmProduction() }
        errorSettings.setOnClickListener { openServerScreen() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })

        if (savedInstanceState == null) handleLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        when {
            // First start, or the server screen switched it.
            store.current != showing -> load()
            // Left in the background long enough that the page may be out of
            // date — a deploy since, or a departure that has filled up.
            pausedAt != 0L && SystemClock.elapsedRealtime() - pausedAt > STALE_AFTER_MS -> web.reload()
        }
        pausedAt = 0L
    }

    override fun onPause() {
        hold.cancel()
        web.onPause()
        CookieManager.getInstance().flush()
        pausedAt = SystemClock.elapsedRealtime()
        super.onPause()
    }

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        hold.onTouch(event)
        return super.dispatchTouchEvent(event)
    }

    /* ------------------------------------------------------------------ *
     * The page
     * ------------------------------------------------------------------ */

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // the sign-in lives in localStorage
            mediaPlaybackRequiresUserGesture = false // the QR scanner's camera preview
            setSupportMultipleWindows(true) // so links that open a new tab reach onCreateWindow
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString SeatPlannerApp/${BuildConfig.VERSION_NAME}"
        }
        web.webViewClient = PageClient()
        web.webChromeClient = ChromeClient()
        web.setDownloadListener { url, _, _, _, _ -> openOutside(Uri.parse(url)) }
    }

    /** Show the chosen server's front page, starting a fresh history. */
    private fun load() {
        val server = store.current
        showing = server
        connectBridge(server)
        // chrome://inspect on a computer reaches the page while developing.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || store.local != null)

        val local = store.local
        devStrip.isVisible = local != null
        if (local != null) devStrip.text = getString(R.string.dev_strip, Servers.label(local))

        hideError()
        clearHistoryOnLoad = true
        web.loadUrl(server)
    }

    /**
     * Give the page its [PageScripts.BRIDGE] object and the pull guard — for
     * this server's origin only, so no other site the page might show can
     * reach them.
     */
    private fun connectBridge(server: String) {
        val origins = setOf(originOf(Uri.parse(server)))

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(web, PageScripts.BRIDGE)
            WebViewCompat.addWebMessageListener(web, PageScripts.BRIDGE, origins) { _, message, origin, isMainFrame, _ ->
                if (isMainFrame && originOf(origin) == originOf(Uri.parse(server))) onPageMessage(message.data)
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            pullGuard?.remove()
            pullGuard = WebViewCompat.addDocumentStartJavaScript(web, PageScripts.PULL_GUARD, origins)
        }
    }

    private fun onPageMessage(data: String?) {
        val message = try {
            JSONObject(data ?: return)
        } catch (e: JSONException) {
            return
        }
        when (message.optString("type")) {
            "pull" -> pullBlocked = message.optBoolean("blocked")
            "pdf" -> TicketFiles.open(this, message.optString("name"), message.optString("data"))
        }
    }

    private inner class PageClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (isOurs(url)) return false
            openOutside(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            mainFrameFailed = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            refresher.isRefreshing = false
            if (clearHistoryOnLoad) {
                view.clearHistory()
                clearHistoryOnLoad = false
            }
            if (!mainFrameFailed) hideError()
            // Older WebViews cannot run it at document start; it is safe twice.
            view.evaluateJavascript(PageScripts.PULL_GUARD, null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            mainFrameFailed = true
            refresher.isRefreshing = false
            showError(error.description?.toString())
        }

        // The page's process ended (usually the phone ran short of memory).
        // Start again with a new WebView rather than crash.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            recreate()
            return true
        }
    }

    private inner class ChromeClient : WebChromeClient() {

        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (newProgress >= 100) {
                progress.hide()
            } else {
                progress.show()
                progress.setProgressCompat(newProgress, true)
            }
        }

        /** The ticket checker's QR scanner: the camera, for our own pages only. */
        override fun onPermissionRequest(request: PermissionRequest) {
            val camera = PermissionRequest.RESOURCE_VIDEO_CAPTURE
            if (camera !in request.resources || !isOurs(request.origin)) {
                request.deny()
                return
            }
            val granted = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
            if (granted) {
                request.grant(arrayOf(camera))
            } else {
                pendingCamera?.deny()
                pendingCamera = request
                cameraPermission.launch(Manifest.permission.CAMERA)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingCamera == request) pendingCamera = null
        }

        /**
         * A link that would open a new tab. There are no tabs: our own pages
         * open here, anything else in the browser. A throwaway WebView catches
         * the address, since Android only says which one once it starts loading.
         */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val popup = WebView(this@MainActivity)
            popup.webViewClient = object : WebViewClient() {
                private var taken = false

                private fun take(target: WebView, url: Uri) {
                    if (taken) return
                    taken = true
                    target.stopLoading()
                    target.post { target.destroy() }
                    if (isOurs(url)) web.loadUrl(url.toString()) else openOutside(url)
                }

                override fun shouldOverrideUrlLoading(target: WebView, request: WebResourceRequest): Boolean {
                    take(target, request.url)
                    return true
                }

                override fun onPageStarted(target: WebView, url: String?, favicon: Bitmap?) {
                    if (url != null && url != "about:blank") take(target, Uri.parse(url))
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = popup
            resultMsg.sendToTarget()
            return true
        }
    }

    /* ------------------------------------------------------------------ *
     * Back, errors, other apps
     * ------------------------------------------------------------------ */

    private fun goBack() {
        if (errorPanel.isVisible) {
            if (web.canGoBack()) {
                hideError()
                web.goBack()
            } else {
                finish()
            }
            return
        }
        // A dialog or the menu drawer closes first, as Escape would close it.
        web.evaluateJavascript(PageScripts.CLOSE_LAYER) { closed ->
            when {
                closed == "true" -> Unit
                web.canGoBack() -> web.goBack()
                else -> finish()
            }
        }
    }

    private fun showError(detail: String?) {
        val local = store.local
        if (local == null) {
            errorTitle.setText(R.string.error_title)
            errorText.setText(R.string.error_text)
        } else {
            errorTitle.text = getString(R.string.error_title_local, Servers.label(local))
            errorText.setText(R.string.error_text_local)
        }
        errorDetail.text = detail.orEmpty()
        errorDetail.isVisible = !detail.isNullOrBlank()
        errorProduction.isVisible = local != null
        errorSettings.isVisible = local != null
        errorPanel.isVisible = true
        progress.hide()
    }

    private fun hideError() {
        errorPanel.isVisible = false
    }

    private fun isOurs(url: Uri?): Boolean {
        val server = showing ?: return false
        return url != null && originOf(url) == originOf(Uri.parse(server))
    }

    /** Another site, an email address, a phone number: whichever app handles it. */
    private fun openOutside(url: Uri) {
        if (url.scheme?.lowercase() !in OUTSIDE_SCHEMES) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }

    /* ------------------------------------------------------------------ *
     * Switching server
     * ------------------------------------------------------------------ */

    private fun openServerScreen() {
        startActivity(Intent(this, ServerActivity::class.java))
    }

    /** A switch link — scanned from a computer's "Open on phone" page. */
    private fun handleLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val link = intent.dataString ?: return
        when (val asked = Servers.readLink(link)) {
            null -> Unit
            is Servers.LinkRequest.Switch -> confirmSwitch(asked.url)
            is Servers.LinkRequest.Refused -> MaterialAlertDialogBuilder(this)
                .setTitle(R.string.link_refused_title)
                .setMessage(getString(R.string.link_refused_text, asked.asked.ifBlank { "—" }))
                .setPositiveButton(android.R.string.ok, null)
                .show()
        }
    }

    private fun confirmSwitch(url: String) {
        if (url == store.local) {
            Toast.makeText(this, getString(R.string.switch_already, Servers.label(url)), Toast.LENGTH_SHORT).show()
            return
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.switch_title)
            .setMessage(getString(R.string.switch_text, Servers.label(url)))
            .setPositiveButton(R.string.switch_yes) { _, _ ->
                store.useLocal(url)
                load()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmProduction() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.production_title)
            .setMessage(getString(R.string.production_text, Servers.label(Servers.production)))
            .setPositiveButton(R.string.production_yes) { _, _ ->
                store.useProduction()
                load()
            }
            .setNeutralButton(R.string.server_settings) { _, _ -> openServerScreen() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /* ------------------------------------------------------------------ */

    /**
     * Edge to edge, as Android 15 requires: the brand colour fills behind the
     * status bar, and the page stops at the navigation bar and the keyboard.
     */
    private fun fitToSystemBars() {
        val statusBackdrop = findViewById<View>(R.id.status_backdrop)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            statusBackdrop.updateLayoutParams { height = bars.top }
            view.setPadding(bars.left, 0, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    private companion object {
        /** Reload a page left in the background for longer than this. */
        const val STALE_AFTER_MS = 30 * 60 * 1000L

        val OUTSIDE_SCHEMES = setOf("http", "https", "mailto", "tel", "sms")

        fun originOf(url: Uri): String {
            val port = if (url.port == -1) "" else ":${url.port}"
            return "${url.scheme?.lowercase()}://${url.host?.lowercase()}$port"
        }
    }
}
