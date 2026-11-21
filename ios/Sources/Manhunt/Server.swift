import Foundation

/// The game server the app shows. It is built in: the game is hosted at one
/// address that doesn't change (the repository's fly.toml), so there is
/// nothing to type or choose. `build.sh --server` builds a different one in,
/// for trying the app against a test server.
enum Server {
    /// Where the game is hosted
    private static let hosted = URL(string: "https://manhunt.fly.dev")!

    static let url: URL = builtInstead ?? hosted

    /// The address `build.sh --server` put in the app, if it was given one
    private static var builtInstead: URL? {
        guard let file = Bundle.module.url(forResource: "server-override", withExtension: "txt"),
              let text = try? String(contentsOf: file, encoding: .utf8) else { return nil }
        return normalize(text)
    }

    /// The server's address from how it was written: "name.example.com", a
    /// full link, or anything between. Only https works: the camera and
    /// compass need it.
    static func normalize(_ text: String) -> URL? {
        var address = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty { return nil }
        if address.lowercased().hasPrefix("http://") { return nil }
        if !address.lowercased().hasPrefix("https://") { address = "https://" + address }

        guard let written = URLComponents(string: address),
              let host = written.host?.lowercased(), host.contains("."), !host.hasSuffix(".") else { return nil }

        var origin = URLComponents()
        origin.scheme = "https"
        origin.host = host
        origin.port = written.port
        return origin.url
    }
}
