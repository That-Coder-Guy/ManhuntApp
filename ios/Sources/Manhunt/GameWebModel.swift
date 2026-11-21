import AVFoundation
import UIKit
import WebKit

/// The web view showing the web app from the game server, and the app's side of
/// the bridge its page talks to (Resources/bridge.js).
@MainActor
final class GameWebModel: NSObject, ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready
        case failed(String)
    }

    @Published private(set) var phase = Phase.loading
    /// True while the "Allow it in Settings" alert is up (GameScreen shows it)
    @Published var showsSettingsHelp = false

    let serverURL: URL
    let webView: WKWebView

    private let location = LocationBridge()
    private let notifications = NotificationBridge()
    private var loadedAt = Date()
    /// The notification state the page's start script was last written with
    private var scriptedNotifications: String?

    /// Left on the landing page this long, the app reloads to pick up a new
    /// version (the web app's own update check needs a service worker, which
    /// a web view doesn't have)
    private static let staleAfter: TimeInterval = 30 * 60

    init(serverURL: URL) {
        self.serverURL = serverURL

        let configuration = WKWebViewConfiguration()
        // The QR scanner's viewfinder plays in the page, not full screen
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)

        super.init()

        webView.configuration.userContentController
            .addScriptMessageHandler(BridgeMessages(model: self), contentWorld: .page, name: "manhunt")

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        // Dark behind the page while it loads, and nothing of the web view's
        // own moving: the web app handles its scrolling and safe areas
        webView.isOpaque = false
        webView.backgroundColor = Theme.pageUI
        webView.scrollView.backgroundColor = Theme.pageUI
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false

        // Each fix is handed to the page whether or not it is listening: in
        // the background that is also what wakes the page, so it can keep
        // its connection to the server going
        location.onFix = { [weak self] fix in self?.call("location", fix) }
        location.onError = { [weak self] code, message in self?.call("locationError", code, message) }
        location.onPermissionChange = { [weak self] state in self?.call("permission", "geolocation", state) }

        // The page reads whether notifications are allowed the moment it
        // starts, so that has to be known before it loads
        notifications.refresh { [weak self] _ in
            self?.installBridgeScript()
            self?.load()
        }
    }

    func load() {
        phase = .loading
        var request = URLRequest(url: serverURL)
        request.timeoutInterval = 20
        // ngrok's free tunnels put a warning page in front of browsers unless asked not to
        if serverURL.host?.contains("ngrok") == true {
            request.setValue("1", forHTTPHeaderField: "ngrok-skip-browser-warning")
        }
        webView.load(request)
    }

    /// The app came back to the screen
    func becameActive() {
        // What a notification said is on screen now
        notifications.clearFound()
        // It may have been changed in Settings meanwhile
        notifications.refresh { [weak self] state in
            self?.call("permission", "notifications", state)
            self?.installBridgeScript()
        }

        if case .failed = phase { return load() }
        let onLandingPage = webView.url?.path == "/" || webView.url?.path.isEmpty == true
        if phase == .ready, onLandingPage, Date().timeIntervalSince(loadedAt) > Self.staleAfter {
            webView.reload()
        }
    }

    // ---- The script each page starts with ----

    private static let bridgeScript: String = {
        guard let file = Bundle.module.url(forResource: "bridge", withExtension: "js"),
              let script = try? String(contentsOf: file, encoding: .utf8) else {
            assertionFailure("bridge.js is missing from the app")
            return ""
        }
        return script
    }()

    /// bridge.js, after what the page needs to know before it can ask.
    /// Written again when that changes, so the next page to load starts
    /// with the truth.
    private func installBridgeScript() {
        let state = notifications.state
        if state == scriptedNotifications { return }
        scriptedNotifications = state

        // nativeLocation: the page's positions come from LocationBridge
        let initial: [String: Any] = ["notifications": state, "nativeLocation": true]
        guard let json = try? JSONSerialization.data(withJSONObject: initial),
              let object = String(data: json, encoding: .utf8) else { return }

        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(
            source: "window.__manhuntInitial = \(object);\n\(Self.bridgeScript)",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }

    // ---- Talking to the page ----

    /// Call `window.__manhuntNative.<function>(…arguments)` in the page
    private func call(_ function: String, _ arguments: Any...) {
        guard let json = try? JSONSerialization.data(withJSONObject: arguments),
              let list = String(data: json, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__manhuntNative?.\(function)(...\(list))", completionHandler: nil)
    }

    /// Only the game server's own page may use the bridge, the camera and the compass
    private func isGame(_ origin: WKSecurityOrigin) -> Bool {
        // A security origin's port is 0 when it's the scheme's usual one
        let port = origin.port == 0 ? 443 : origin.port
        return origin.protocol == "https" && origin.host == serverURL.host && port == serverURL.port ?? 443
    }

    /// A message from bridge.js; `reply` gives it its answer (once, always)
    fileprivate func handle(_ message: WKScriptMessage, reply: @escaping (Any?) -> Void) {
        guard message.frameInfo.isMainFrame, isGame(message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return reply(nil) }

        switch type {
        case "location-start":
            location.start()
        case "location-stop":
            location.stop()
        case "permission-query":
            switch body["name"] as? String {
            case "geolocation": return reply(location.permission)
            case "camera": return reply(Self.cameraPermission)
            default: break
            }
        case "notifications-request":
            // The web app's Notifications switch: iOS asks the player, once
            return notifications.request { [weak self] state in
                self?.installBridgeScript()
                reply(state)
            }
        case "session":
            // In a lobby: keep running, and sending the player's position, in the background
            location.inLobby = body["active"] as? Bool == true
        case "settings":
            // The web app's "Open settings": beside a blocked switch the app
            // first says what Manhunt needs there; for turning one off the
            // page has already said why, so it goes straight there
            if body["direct"] as? Bool == true {
                openPhoneSettings()
            } else {
                showsSettingsHelp = true
            }
        case "found":
            // Looking at the game: it says so itself
            if UIApplication.shared.applicationState != .active,
               let title = body["title"] as? String, let text = body["body"] as? String {
                notifications.showFound(title: title, body: text)
            }
        default:
            break
        }
        reply(nil)
    }

    /// Manhunt's own page in the phone's Settings, where a refused permission can be allowed
    func openPhoneSettings() {
        guard let settings = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(settings)
    }

    private static var cameraPermission: String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    /// A new page is listening for nothing and is in no lobby until it says so
    private func resetPageState() {
        location.stop()
        location.inLobby = false
    }

    private func fail(_ error: Error) {
        let error = error as NSError
        // Cancelled: a newer navigation replaced this one
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
        // 102: this app stopped the load itself (an error page, see decidePolicyFor)
        if error.domain == "WebKitErrorDomain" && error.code == 102 { return }
        resetPageState()
        phase = .failed(error.localizedDescription)
    }
}

/// Passes the page's messages on without the web view keeping the model alive
private final class BridgeMessages: NSObject, WKScriptMessageHandlerWithReply {
    private weak var model: GameWebModel?

    init(model: GameWebModel) {
        self.model = model
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let model else { return replyHandler(nil, nil) }
        model.handle(message) { answer in replyHandler(answer, nil) }
    }
}

extension GameWebModel: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }

        // Frames inside the page (the web app opens blank ones) are its own business
        if navigationAction.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }

        // The app stays on the game server; any other link opens in the browser
        let sameServer = url.scheme == "https" && url.host == serverURL.host && url.port == serverURL.port
        if navigationAction.targetFrame != nil && sameServer { return decisionHandler(.allow) }

        if ["http", "https", "mailto", "tel", "sms", "maps"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        // A host whose server is down answers with its own error page: say
        // so natively, with a way to try again
        if navigationResponse.isForMainFrame,
           let status = (navigationResponse.response as? HTTPURLResponse)?.statusCode, status >= 400 {
            resetPageState()
            phase = .failed("The server answered with an error (\(status))")
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        resetPageState()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadedAt = Date()
        phase = .ready
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS reclaimed the page's memory: start it again
        resetPageState()
        load()
    }
}

extension GameWebModel: WKUIDelegate {
    // The web view would otherwise ask "Allow <address> to use your camera /
    // motion?" on top of iOS's own prompt, again on every launch
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(isGame(origin) && type == .camera ? .grant : .deny)
    }

    func webView(
        _ webView: WKWebView,
        requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(isGame(origin) ? .grant : .deny)
    }

    // target="_blank" links and window.open: in the browser, not a second web view
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }
}
