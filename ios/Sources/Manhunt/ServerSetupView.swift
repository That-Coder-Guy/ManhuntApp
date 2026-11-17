import SwiftUI

/// Choosing the game server: shown on first launch, from "Change server" on
/// the app icon, and from the "can't reach the server" screen.
struct ServerSetupView: View {
    @EnvironmentObject private var server: ServerStore

    @State private var address = ""
    @State private var isChecking = false
    @State private var problem: String?
    @FocusState private var addressFocused: Bool

    var body: some View {
        ZStack {
            Theme.page.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Game server")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("Enter the address your Manhunt server gives, like name.trycloudflare.com")
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 8) {
                    TextField("", text: $address, prompt: Text("Server address").foregroundColor(Theme.textTertiary))
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.text)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($addressFocused)
                        .onSubmit(connect)
                        .padding(.horizontal, 16)
                        .frame(height: 52)
                        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.hairline))

                    if let problem {
                        Text(problem)
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.negative)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                VStack(spacing: 12) {
                    Button(action: connect) {
                        ZStack {
                            Text("Connect").opacity(isChecking ? 0 : 1)
                            if isChecking { ProgressView().tint(Theme.onAccent) }
                        }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(isChecking || address.trimmingCharacters(in: .whitespaces).isEmpty)

                    // Only when there's a game to go back to
                    if server.url != nil {
                        Button("Cancel") { server.isChoosing = false }
                            .font(.system(size: 17))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .disabled(isChecking)
                    }
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: 480)
        }
        .onAppear {
            address = server.url?.host ?? ""
            addressFocused = server.url == nil
        }
    }

    private func connect() {
        guard !isChecking else { return }
        guard let url = ServerStore.normalize(address) else {
            problem = address.lowercased().hasPrefix("http://")
                ? "The address needs to start with https"
                : "That doesn't look like a server address"
            return
        }

        isChecking = true
        problem = nil
        Task {
            do {
                try await ServerStore.check(url)
                server.use(url)
            } catch ServerStore.CheckError.notManhunt(let detail) {
                problem = "Something answered at \(url.host ?? "that address"), but it isn't a Manhunt server. \(detail)"
            } catch ServerStore.CheckError.unreachable(let reason) {
                problem = "Couldn't reach \(url.host ?? "that address"). \(reason)"
            } catch {
                problem = "Couldn't reach \(url.host ?? "that address"). \(error.localizedDescription)"
            }
            isChecking = false
        }
    }
}
