import SwiftUI
import UIKit

// The iOS app is a shell: one full-screen web view showing the Manhunt web
// app from the game server, unchanged, with the phone's own location service
// behind it (see Resources/bridge.js). The only native screens are choosing
// the server and saying it can't be reached.

@main
struct ManhuntApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var server = ServerStore.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(server)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var server: ServerStore

    var body: some View {
        ZStack {
            Theme.page.ignoresSafeArea()

            if let url = server.url {
                // A different server is a different game: start afresh
                GameScreen(serverURL: url).id(url)
            }
            if server.url == nil || server.isChoosing {
                ServerSetupView()
            }
        }
    }
}

// ---- "Change server" on the app icon ----
//
// The web app fills the screen, so the way back to the server screen is a
// long press on the app's icon (and the "can't reach the server" screen).

private let changeServerAction = "change-server"

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        application.shortcutItems = [
            UIApplicationShortcutItem(
                type: changeServerAction,
                localizedTitle: "Change server",
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "antenna.radiowaves.left.and.right")
            )
        ]
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        // Opened from the icon's menu while the app wasn't running
        if options.shortcutItem?.type == changeServerAction {
            ServerStore.shared.isChoosing = true
        }
        let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let known = shortcutItem.type == changeServerAction
        if known { ServerStore.shared.isChoosing = true }
        completionHandler(known)
    }
}
