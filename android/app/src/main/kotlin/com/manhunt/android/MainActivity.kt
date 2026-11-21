package com.manhunt.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.concurrent.Executors

// The Android app is a shell: one full-screen web view showing the Manhunt
// web app from the game server (Server.kt), unchanged (see assets/bridge.js
// for the few things handed to the phone). The only native screen is the one
// saying the server can't be reached.

class MainActivity : ComponentActivity(), PageBridge.Host {

    private lateinit var webContainer: FrameLayout
    private lateinit var loading: View
    private lateinit var problem: View
    private lateinit var problemHost: TextView
    private lateinit var problemReason: TextView

    /** The web view showing the server's page */
    private var webView: GameWebView? = null
    private var bridge: PageBridge? = null
    /** True from a failed load until the next one starts, so the web view's own error page is never shown */
    private var loadFailed = false

    /** The lobby the page's player is in (and whether its game is running), or null when in none */
    private var session: Session? = null
    /** What GameService was last started for, once Android has let it start */
    private var serviceSession: Session? = null
    /** True while the app is the one on screen */
    private var onScreen = false

    private data class Session(val lobbyName: String, val playing: Boolean)

    private val background = Executors.newSingleThreadExecutor()

    // ---- Android's permission prompts, one at a time ----

    private class PermissionAsk(val permissions: Array<String>, val done: (Boolean) -> Unit)

    private val permissionAsks = ArrayDeque<PermissionAsk>()

    private val permissionPrompt = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val ask = permissionAsks.removeFirstOrNull() ?: return@registerForActivityResult
        val granted = hasAny(ask.permissions)
        // Refused with no way to be asked again: Android won't show the prompt
        // any more, so the web app should say "Blocked", not offer to ask
        val blocked = !granted && ask.permissions.none { shouldShowRequestPermissionRationale(it) }
        ask.permissions.forEach { blockedPermissions.edit().putBoolean(it, blocked).apply() }
        ask.done(granted)
        permissionAsks.firstOrNull()?.let { launchPermissionPrompt(it) }
    }

    private val blockedPermissions by lazy { getSharedPreferences("blocked-permissions", Context.MODE_PRIVATE) }

    // ---- Choosing a file (the profile picture) ----

    private var fileChoice: ValueCallback<Array<Uri>>? = null

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileChoice?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileChoice = null
    }

    // ---- Starting up ----

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webContainer = findViewById(R.id.web_container)
        loading = findViewById(R.id.loading)
        problem = findViewById(R.id.problem)
        problemHost = findViewById(R.id.problem_host)
        problemReason = findViewById(R.id.problem_reason)

        // The app draws behind the status and navigation bars (Android 15
        // insists), so everything is kept clear of them, and of the keyboard
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        findViewById<Button>(R.id.problem_retry).setOnClickListener { load() }
        onBackPressedDispatcher.addCallback(this, back)

        // Versions that asked for the server's address kept what was typed
        deleteSharedPreferences("server")

        openServer()
    }

    override fun onResume() {
        super.onResume()
        onScreen = true
        // They may have been changed in the phone's Settings meanwhile
        bridge?.notifyPermission("geolocation")
        bridge?.notifyPermission("camera")
        bridge?.notifyPermission("notifications")
        // Looking at the app now: what the notification said is on screen
        Notifications.clearFound(this)
        // A lobby joined while the app was in the background couldn't start its service then
        syncSession()
    }

    override fun onPause() {
        onScreen = false
        super.onPause()
    }

    override fun onDestroy() {
        background.shutdown()
        closeWebView()
        super.onDestroy()
    }

    /** Back: back through the web app's pages, then out of the app */
    private val back = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val web = webView
            if (problem.visibility != View.VISIBLE && web != null && web.canGoBack()) return web.goBack()
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
        }
    }

    // ---- The web view ----

    /** Show the server's web app in a fresh web view */
    @SuppressLint("SetJavaScriptEnabled")
    private fun openServer() {
        closeWebView()

        val web = GameWebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.setGeolocationEnabled(true)
        // The QR scanner's viewfinder starts by itself
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.setBackgroundColor(getColor(R.color.ink_page))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.webViewClient = pages
        web.webChromeClient = prompts
        bridge = PageBridge(this).also { it.attach(web, Server.ORIGIN) }

        webContainer.addView(web, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        webView = web
        load()
    }

    private fun closeWebView() {
        sessionChanged(false, false, "")
        bridge = null
        webView?.let {
            webContainer.removeView(it)
            it.destroy()
        }
        webView = null
    }

    private fun load() {
        val web = webView ?: return
        loadFailed = false
        problem.visibility = View.GONE
        loading.visibility = View.VISIBLE
        web.visibility = View.INVISIBLE
        // ngrok's free tunnels put a warning page in front of browsers unless asked not to
        val headers = if ("ngrok" in Server.ORIGIN) mapOf("ngrok-skip-browser-warning" to "1") else emptyMap()
        web.loadUrl("${Server.ORIGIN}/", headers)
        checkServerIsThere()
    }

    /**
     * The web app keeps a copy of itself on the phone, so it opens even when
     * its server is down, and the page would then sit there "reconnecting"
     * without saying why. So each time the page is loaded the server is asked
     * directly, and if it doesn't answer, say so. With no connection at all,
     * the web app's own offline screen is the right one and is left alone.
     */
    private fun checkServerIsThere() {
        background.execute {
            val check = Server.check()
            runOnUiThread {
                if (isDestroyed || loadFailed) return@runOnUiThread
                when (check) {
                    Server.Check.Ok -> Unit
                    is Server.Check.NotManhunt -> showProblem(
                        check.httpStatus?.let { getString(R.string.problem_http, it) }
                            ?: getString(R.string.problem_not_manhunt)
                    )
                    is Server.Check.Unreachable -> if (isOnline()) showProblem(check.reason)
                }
            }
        }
    }

    /** True when the phone has a connection that reaches the internet */
    private fun isOnline(): Boolean {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val network = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun showProblem(reason: String) {
        loadFailed = true
        sessionChanged(false, false, "")
        loading.visibility = View.GONE
        webView?.visibility = View.INVISIBLE
        problemHost.text = Server.host
        problemReason.text = reason
        problem.visibility = View.VISIBLE
    }

    /** Only the game server's own page is given the phone's location and camera */
    private fun isServer(uri: Uri?): Boolean {
        if (uri == null || uri.scheme != "https") return false
        val port = if (uri.port == -1) 443 else uri.port
        return Server.ORIGIN == (if (port == 443) "https://${uri.host}" else "https://${uri.host}:$port")
    }

    private val pages = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // Frames inside the page are its own business
            if (!request.isForMainFrame) return false
            // The app stays on the game server; any other link opens in the browser
            if (isServer(request.url)) return false
            if (request.url.scheme in EXTERNAL_SCHEMES) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) { /* nothing on this phone opens it */ }
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // A new page is in no lobby until it says so
            sessionChanged(false, false, "")
        }

        override fun onPageCommitVisible(view: WebView, url: String?) {
            if (loadFailed) return
            loading.visibility = View.GONE
            view.visibility = View.VISIBLE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showProblem(error.description?.toString().orEmpty())
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            // A host whose server is down answers with its own error page:
            // say so natively, with a way to try again
            if (request.isForMainFrame && response.statusCode >= 400) {
                showProblem(getString(R.string.problem_http, response.statusCode))
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Android reclaimed the page's memory (or it crashed): start it again
            openServer()
            return true
        }
    }

    private val prompts = object : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (!isServer(Uri.parse(origin))) return callback.invoke(origin, false, false)
            withPermission(LOCATION) { granted ->
                callback.invoke(origin, granted, false)
                bridge?.notifyPermission("geolocation")
            }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
            if (!wantsCamera || !isServer(request.origin)) return request.deny()
            withPermission(CAMERA) { granted ->
                if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
                bridge?.notifyPermission("camera")
            }
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
        ): Boolean {
            fileChoice?.onReceiveValue(null)
            fileChoice = filePathCallback
            return try {
                filePicker.launch(fileChooserParams.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                fileChoice = null
                false
            }
        }
    }

    // ---- Permissions ----

    private fun hasAny(permissions: Array<String>) =
        permissions.any { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }

    /** Run `done` with whether one of `permissions` is allowed, asking the player first if need be */
    private fun withPermission(permissions: Array<String>, done: (Boolean) -> Unit) {
        if (hasAny(permissions)) return done(true)
        val ask = PermissionAsk(permissions, done)
        permissionAsks.addLast(ask)
        if (permissionAsks.size == 1) launchPermissionPrompt(ask)
    }

    private fun launchPermissionPrompt(ask: PermissionAsk) {
        if (hasAny(ask.permissions)) {
            // Allowed while it waited its turn
            permissionAsks.removeFirstOrNull()
            ask.done(true)
            permissionAsks.firstOrNull()?.let { launchPermissionPrompt(it) }
        } else {
            permissionPrompt.launch(ask.permissions)
        }
    }

    private fun permissionsFor(name: String): Array<String>? = when (name) {
        "geolocation" -> LOCATION
        "camera" -> CAMERA
        else -> null
    }

    // ---- What the page can ask for (PageBridge.Host) ----

    override fun permissionState(name: String): String? {
        if (name == "notifications") return when {
            Notifications.allowed(this) -> "granted"
            // Before Android 13 there is no prompt: off means turned off in Settings
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> "denied"
            blockedPermissions.getBoolean(Manifest.permission.POST_NOTIFICATIONS, false) -> "denied"
            else -> "prompt"
        }
        val permissions = permissionsFor(name) ?: return null
        return when {
            hasAny(permissions) -> "granted"
            permissions.all { blockedPermissions.getBoolean(it, false) } -> "denied"
            else -> "prompt"
        }
    }

    override fun requestNotifications(done: (String) -> Unit) {
        val state = permissionState("notifications") ?: "denied"
        if (state != "prompt" || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return done(state)
        withPermission(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) {
            bridge?.refreshStartScript()
            done(permissionState("notifications") ?: "denied")
        }
    }

    override fun sessionChanged(inLobby: Boolean, playing: Boolean, lobbyName: String) {
        session = if (inLobby) Session(lobbyName, playing) else null
        syncSession()
    }

    /**
     * Keep the app going for exactly as long as the player is in a lobby:
     * GameService stops Android shutting the app down in the background, and
     * the web view carries on as if it were on screen (GameWebView).
     */
    private fun syncSession() {
        val wanted = session
        webView?.stayAwake = wanted != null
        if (wanted == null) {
            if (serviceSession != null) GameService.stop(this)
            serviceSession = null
        } else if (wanted != serviceSession && hasAny(LOCATION)) {
            // Android only lets an app that's on screen start it; if this one
            // isn't, onResume tries again
            if (GameService.start(this, wanted.lobbyName, wanted.playing)) serviceSession = wanted
        }
    }

    /**
     * A permission that was refused can only be allowed again in Android's
     * Settings (the web app's switch can't ask twice). Say which ones Manhunt
     * needs there, then open its page. `direct` skips the saying: the page
     * has already told the player why (turning one off, which is theirs to do).
     */
    override fun openPhoneSettings(direct: Boolean) {
        val open = {
            val appSettings = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
            try {
                startActivity(appSettings)
            } catch (_: ActivityNotFoundException) { /* no such screen on this phone */ }
        }
        if (direct) return open()

        AlertDialog.Builder(this)
            .setTitle(R.string.phone_settings_title)
            .setMessage(R.string.phone_settings_message)
            .setPositiveButton(R.string.phone_settings_open) { _, _ -> open() }
            .setNegativeButton(R.string.phone_settings_not_now, null)
            .show()
    }

    override fun someoneFound(title: String, body: String) {
        // Looking at the game: it says so itself
        if (!onScreen) Notifications.showFound(this, title, body)
    }

    override fun share(title: String, text: String, url: String): Boolean {
        val message = listOf(text, url).filter { it.isNotBlank() }.joinToString(" ")
        if (message.isEmpty()) return false
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, message)
        if (title.isNotBlank()) send.putExtra(Intent.EXTRA_TITLE, title)
        return try {
            startActivity(Intent.createChooser(send, getString(R.string.share_chooser_title)))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    private companion object {
        val EXTERNAL_SCHEMES = setOf("http", "https", "mailto", "tel", "sms", "geo")
        val LOCATION = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val CAMERA = arrayOf(Manifest.permission.CAMERA)
    }
}
