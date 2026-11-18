package com.manhunt.android

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONException
import org.json.JSONObject

/**
 * The app's side of the bridge the web app's page talks to (assets/bridge.js).
 * Only the game server's own page gets the script and the `manhuntApp` object
 * it posts messages through; the web view enforces that by origin.
 */
class PageBridge(private val host: Host) : WebViewCompat.WebMessageListener {

    /** What the page can ask of the app, and what it tells it */
    interface Host {
        /** "granted" | "denied" | "prompt" for "geolocation", "camera" or "notifications"; null for anything else */
        fun permissionState(name: String): String?
        /** Open the share sheet; false if there's nothing to share */
        fun share(title: String, text: String, url: String): Boolean
        /** Ask Android to let the app notify (if it still needs asking), then `done` with the state */
        fun requestNotifications(done: (String) -> Unit)
        /** The player joined or left a lobby, or its game started or stopped */
        fun sessionChanged(inLobby: Boolean, playing: Boolean, lobbyName: String)
        /** Someone was found: say so, unless the player is looking at the game */
        fun someoneFound(title: String, body: String)
        /** Open Manhunt's page in the phone's Settings, saying first what it needs there unless `direct` */
        fun openPhoneSettings(direct: Boolean)
    }

    private var webView: WebView? = null
    private var origins: Set<String> = emptySet()
    private var bridgeScript = ""
    private var installedScript: ScriptHandler? = null
    private var installedState: String? = null

    /** Attach to a web view that hasn't loaded anything yet. False if this phone's web view is too old. */
    fun attach(webView: WebView, serverOrigin: String): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return false

        this.webView = webView
        origins = setOf(serverOrigin)
        bridgeScript = webView.context.assets.open("bridge.js").bufferedReader().use { it.readText() }
        WebViewCompat.addWebMessageListener(webView, "manhuntApp", origins, this)
        refreshStartScript()
        return true
    }

    /**
     * The script each page starts with: bridge.js, after what the page needs
     * to know before it can ask (whether notifications are allowed, which the
     * web app reads the moment it starts). Called again when that changes,
     * so the next page to load starts with the truth.
     */
    @SuppressLint("RequiresFeature") // attach() checked, and nothing is installed without it
    fun refreshStartScript() {
        val web = webView ?: return
        val notifications = host.permissionState("notifications") ?: "prompt"
        if (notifications == installedState) return

        // nativeLocation false: Android's web view reads location itself
        val initial = JSONObject().put("notifications", notifications).put("nativeLocation", false)
        installedScript?.remove()
        installedScript = WebViewCompat.addDocumentStartJavaScript(web, "window.__manhuntInitial = $initial;\n$bridgeScript", origins)
        installedState = notifications
    }

    /** Tell the page that's open a permission changed (see `__manhuntNative.permission` in bridge.js) */
    fun notifyPermission(name: String) {
        val web = webView ?: return
        val state = host.permissionState(name) ?: return
        web.evaluateJavascript("window.__manhuntNative?.permission(${JSONObject.quote(name)}, ${JSONObject.quote(state)})", null)
        if (name == "notifications") refreshStartScript()
    }

    // Only ever called when the web view has message listeners (attach checks)
    @SuppressLint("RequiresFeature")
    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy
    ) {
        if (!isMainFrame) return
        val request = try { JSONObject(message.data ?: return) } catch (_: JSONException) { return }

        val id = request.opt("id")
        val reply = { result: Any? ->
            replyProxy.postMessage(JSONObject().put("id", id).put("result", result ?: JSONObject.NULL).toString())
        }

        when (request.optString("type")) {
            "permission-query" -> reply(host.permissionState(request.optString("name")))
            "share" -> reply(host.share(request.optString("title"), request.optString("text"), request.optString("url")))
            "notifications-request" -> host.requestNotifications { state -> reply(state) }
            "session" -> {
                host.sessionChanged(request.optBoolean("active"), request.optBoolean("playing"), request.optString("lobby"))
                reply(null)
            }
            "found" -> { host.someoneFound(request.optString("title"), request.optString("body")); reply(null) }
            "settings" -> { host.openPhoneSettings(request.optBoolean("direct")); reply(null) }
            // Anything else (the iPhone app's location messages, say) isn't for this app
            else -> reply(null)
        }
    }
}
