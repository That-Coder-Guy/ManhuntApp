import SwiftUI
import WebKit

/// The web app, full screen, with a native screen over it while it loads or
/// when the server can't be reached.
struct GameScreen: View {
    @EnvironmentObject private var server: ServerStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model: GameWebModel

    init(serverURL: URL) {
        _model = StateObject(wrappedValue: GameWebModel(serverURL: serverURL))
    }

    var body: some View {
        ZStack {
            // Below the status bar (which keeps the page colour, like the
            // Home Screen web app) and down to the screen's bottom edge: the
            // web app pads for the home indicator itself. The keyboard is
            // left to the web view, which moves the page as a browser does.
            WebView(webView: model.webView)
                .ignoresSafeArea(.all, edges: [.bottom, .horizontal])
                .opacity(model.phase == .ready ? 1 : 0)

            switch model.phase {
            case .ready:
                EmptyView()
            case .loading:
                ProgressView().tint(Theme.textSecondary)
            case .failed(let reason):
                ConnectionProblem(
                    host: model.serverURL.host ?? "",
                    reason: reason,
                    retry: { model.load() },
                    changeServer: { server.isChoosing = true }
                )
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { model.becameActive() }
        }
    }
}

private struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct ConnectionProblem: View {
    let host: String
    let reason: String
    let retry: () -> Void
    let changeServer: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Can't reach the server")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text(host)
                    .font(.system(size: 15, design: .monospaced))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                Text(reason)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 12) {
                Button(action: retry) {
                    Text("Try again")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                }
                Button(action: changeServer) {
                    Text("Change server")
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.text)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: 480)
    }
}
