import SwiftUI
import UIKit

// The iOS app is a shell: one full-screen web view showing the Manhunt web
// app from the game server (Server.swift), unchanged, with the phone's own
// location service behind it (see Resources/bridge.js). The only native
// screen is the one saying the server can't be reached.

@main
struct ManhuntApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    var body: some View {
        ZStack {
            Theme.page.ignoresSafeArea()
            GameScreen(serverURL: Server.url)
        }
        .task {
            // Versions that asked for the server's address put "Change
            // server" on the app icon's menu and kept the address typed in.
            // iOS holds on to both across an update until told otherwise
            UIApplication.shared.shortcutItems = nil
            UserDefaults.standard.removeObject(forKey: "serverURL")
        }
    }
}
