import CoreLocation

/// The phone's location service, for the web app's `navigator.geolocation`
/// (Resources/bridge.js), and what keeps the app running in the background.
///
/// iOS stops an app soon after it leaves the screen, unless it is doing one
/// of a few things iOS allows in the background. Following the player's
/// location is one, and it is what a game of Manhunt is doing anyway. So
/// while the player is in a lobby the service keeps running with the phone
/// locked or another app in front (iOS shows its blue location indicator),
/// and each fix it hands the page wakes the page up to send it on.
@MainActor
final class LocationBridge: NSObject, CLLocationManagerDelegate {
    /// A fix, as the fields of a browser's GeolocationCoordinates plus `timestamp`
    var onFix: (([String: Any]) -> Void)?
    /// No position: a GeolocationPositionError code (1 not allowed, 2 unavailable) and why
    var onError: ((Int, String) -> Void)?
    /// "granted" | "denied" | "prompt", whenever it changes
    var onPermissionChange: ((String) -> Void)?

    /// True while the player is in a lobby: fixes then keep coming, in the
    /// background too, whether or not the page is asking for them
    var inLobby = false {
        didSet { if inLobby != oldValue { apply() } }
    }

    private let manager = CLLocationManager()
    /// True while the page is listening for positions
    private var wanted = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        // A game is played on foot, and a hider staying put is still playing
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
    }

    var permission: String {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    /// The page wants positions; the first time, iOS asks the player
    func start() {
        wanted = true
        switch permission {
        case "granted": apply()
        case "denied": onError?(1, "Location isn't allowed for Manhunt")
        default: manager.requestWhenInUseAuthorization()
        }
    }

    func stop() {
        wanted = false
        apply()
    }

    /// Run the service exactly when it's wanted and allowed
    private func apply() {
        let allowed = permission == "granted"
        // Needs "location" under UIBackgroundModes in Info.plist, which it has
        manager.allowsBackgroundLocationUpdates = inLobby && allowed
        manager.showsBackgroundLocationIndicator = inLobby
        if (wanted || inLobby) && allowed {
            manager.startUpdatingLocation()
        } else {
            manager.stopUpdatingLocation()
        }
    }

    // ---- CLLocationManagerDelegate (called on the main thread, where the manager was made) ----

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated {
            onPermissionChange?(permission)
            // Answered the prompt, or changed it in Settings and came back
            if wanted && permission == "denied" { onError?(1, "Location isn't allowed for Manhunt") }
            if permission != "prompt" { apply() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // A negative accuracy means the fix is no good
        guard let location = locations.last(where: { $0.horizontalAccuracy >= 0 }) else { return }
        // What the phone doesn't know is null in the page, as in a browser
        let known = { (value: Double, isKnown: Bool) -> Any in isKnown ? value as Any : NSNull() }
        let fix: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "altitude": known(location.altitude, location.verticalAccuracy >= 0),
            "altitudeAccuracy": known(location.verticalAccuracy, location.verticalAccuracy >= 0),
            "heading": known(location.course, location.course >= 0),
            "speed": known(location.speed, location.speed >= 0),
            "timestamp": (location.timestamp.timeIntervalSince1970 * 1000).rounded()
        ]
        MainActor.assumeIsolated {
            guard wanted || inLobby else { return }
            onFix?(fix)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        // "Unknown" only means no fix yet: the service keeps trying
        if code == .locationUnknown { return }
        MainActor.assumeIsolated {
            guard wanted else { return }
            if code == .denied {
                onError?(1, "Location isn't allowed for Manhunt")
            } else {
                onError?(2, "The phone couldn't find its position")
            }
        }
    }
}
