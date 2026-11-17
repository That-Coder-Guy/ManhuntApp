import AVFoundation
import UIKit
import WebKit

/// The web view showing the web app from one server, and the app's side of
/// the bridge its page talks to (Resources/bridge.js).
@MainActor
final class GameWebModel: NSObject, ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready
        case failed(String)
    }

    @Published private(set) var phase = Phase.loading

    let serverURL: URL
    let webView: WKWebView

    private let location = LocationBridge()
    private var loadedAt = Date()

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

        let content = webView.configuration.userContentController
        content.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addScriptMessageHandler(BridgeMessages(model: self), contentWorld: .page, name: "manhunt")

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

        location.onFix = { [weak self] fix in self?.call("location", fix) }
        location.onError = { [weak self] code, message in self?.call("locationError", code, message) }
        location.onPermissionChange = { [weak self] state in self?.call("permission", "geolocation", state) }

        load()
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
        if case .failed = phase { return load() }
        let onLandingPage = webView.url?.path == "/" || webView.url?.path.isEmpty == true
        if phase == .ready, onLandingPage, Date().timeIntervalSince(loadedAt) > Self.staleAfter {
            webView.reload()
        }
    }

    private static let bridgeScript: String = {
        guard let file = Bundle.module.url(forResource: "bridge", withExtension: "js"),
              let script = try? String(contentsOf: file, encoding: .utf8) else {
            assertionFailure("bridge.js is missing from the app")
            return ""
        }
        return script
    }()

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

    /// A message from bridge.js; the return value is its answer
    fileprivate func handle(_ message: WKScriptMessage) -> Any? {
        guard message.frameInfo.isMainFrame, isGame(message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return nil }

        switch type {
        case "location-start":
            location.start()
        case "location-stop":
            location.stop()
        case "wake-lock":
            UIApplication.shared.isIdleTimerDisabled = body["held"] as? Bool == true
        case "permission-query":
            switch body["name"] as? String {
            case "geolocation": return location.permission
            case "camera": return Self.cameraPermission
            default: break
            }
        default:
            break
        }
        return nil
    }

    private static var cameraPermission: String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    /// A new page has nothing listening yet: let go of what the last one held
    private func resetPageState() {
        location.stop()
        UIApplication.shared.isIdleTimerDisabled = false
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
        replyHandler(model?.handle(message), nil)
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
        // A tunnel whose server is down answers with its own error page:
        // say so natively, with a way to change the address
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
