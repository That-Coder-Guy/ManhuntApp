import UserNotifications

/// The app's own notifications, in place of the web app's web push (which a
/// web view can't receive). They are made on the phone, from what the page
/// hears from the server while the app runs in the background, so they need
/// no push service and work with a free Apple ID.
@MainActor
final class NotificationBridge {
    private static let foundID = "found"

    /// "granted" | "denied" | "prompt", as of the last `refresh`
    private(set) var state = "prompt"

    private let center = UNUserNotificationCenter.current()

    /// Ask iOS where things stand (it may have changed in Settings), then `done` with the state
    func refresh(_ done: @escaping @MainActor (String) -> Void) {
        center.getNotificationSettings { settings in
            let state: String
            switch settings.authorizationStatus {
            case .notDetermined: state = "prompt"
            case .denied: state = "denied"
            default: state = "granted"
            }
            Task { @MainActor in
                self.state = state
                done(state)
            }
        }
    }

    /// Ask the player (iOS only ever asks once), then `done` with the state
    func request(_ done: @escaping @MainActor (String) -> Void) {
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            Task { @MainActor in self.refresh(done) }
        }
    }

    /// "Maya was found": a newer one replaces an older one
    func showFound(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        center.add(UNNotificationRequest(identifier: Self.foundID, content: content, trigger: nil))
    }

    /// The player is looking at the game: what the notification said is on screen
    func clearFound() {
        center.removeDeliveredNotifications(withIdentifiers: [Self.foundID])
    }
}
