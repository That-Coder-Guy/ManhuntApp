import Foundation

/// Which game server the app shows. The address is typed in once and kept;
/// a quick tunnel's address changes when the tunnel restarts, so it can be
/// changed again later.
@MainActor
final class ServerStore: ObservableObject {
    static let shared = ServerStore()

    private static let storageKey = "serverURL"

    /// The server in use, or nil until one has been chosen
    @Published private(set) var url: URL?
    /// True while the server screen is open over a running game
    @Published var isChoosing = false

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.storageKey).flatMap(Self.normalize)
        url = saved ?? Self.bundledDefault
    }

    func use(_ newURL: URL) {
        UserDefaults.standard.set(newURL.absoluteString, forKey: Self.storageKey)
        url = newURL
        isChoosing = false
    }

    /// An address baked in when the app was built (`build.sh --server`), if any
    private static var bundledDefault: URL? {
        guard let file = Bundle.module.url(forResource: "default-server", withExtension: "txt"),
              let text = try? String(contentsOf: file, encoding: .utf8) else { return nil }
        return normalize(text)
    }

    /// The server's address from what was typed: "name.trycloudflare.com",
    /// a full invite link, or anything between. Only https works: the camera
    /// and compass need it.
    nonisolated static func normalize(_ text: String) -> URL? {
        var address = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty { return nil }
        if address.lowercased().hasPrefix("http://") { return nil }
        if !address.lowercased().hasPrefix("https://") { address = "https://" + address }

        guard let typed = URLComponents(string: address),
              let host = typed.host?.lowercased(), host.contains("."), !host.hasSuffix(".") else { return nil }

        var origin = URLComponents()
        origin.scheme = "https"
        origin.host = host
        origin.port = typed.port
        return origin.url
    }

    enum CheckError: Error {
        /// Nothing answered; with iOS's own words for why (no connection, timed out, …)
        case unreachable(String)
        /// Something answered, but not a Manhunt server; with what it said instead
        case notManhunt(String)
    }

    /// Makes sure a Manhunt server answers at `url` (its health check)
    nonisolated static func check(_ url: URL) async throws {
        var request = URLRequest(url: url.appendingPathComponent("manhunt-api/health"))
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw CheckError.unreachable(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            throw CheckError.notManhunt("It answered with HTTP \(status)")
        }
        guard let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              body["status"] as? String == "success" else {
            throw CheckError.notManhunt("It answered with something other than the server's health check")
        }
    }
}
