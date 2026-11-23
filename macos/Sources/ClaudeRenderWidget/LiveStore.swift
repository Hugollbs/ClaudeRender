import ClaudeRenderCore
import Foundation

// État observé par la vue : liste des sessions actives + sessions suivies.
// @MainActor : tout est modifié sur le thread principal, SwiftUI peut donc lire sans verrou.
@MainActor
final class LiveStore: ObservableObject {
    private static let followedKey = "followedSessionIds"
    private static let pollInterval: UInt64 = 2_000_000_000 // 2 s, en nanosecondes

    @Published private(set) var sessions: [LiveSession] = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var followed: Set<String>
    // Dans le store (et non en @State de la vue) pour que le panneau soit redimensionné au changement de mode.
    @Published var choosing = false

    let client: LiveClient
    private var pollTask: Task<Void, Never>?

    init(client: LiveClient) {
        self.client = client
        followed = Set(UserDefaults.standard.stringArray(forKey: Self.followedKey) ?? [])
    }

    var visible: [LiveSession] { visibleSessions(sessions, followed: followed) }

    func toggleFollow(_ id: String) {
        if followed.contains(id) { followed.remove(id) } else { followed.insert(id) }
        UserDefaults.standard.set(Array(followed), forKey: Self.followedKey)
    }

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: Self.pollInterval)
            }
        }
    }

    private func refresh() async {
        do {
            sessions = try await client.fetchLive()
            errorMessage = nil
        } catch {
            // On garde la dernière liste connue : un raté réseau ponctuel ne doit pas vider le widget.
            if error is URLError {
                errorMessage = "Serveur injoignable : lance « npm run dev:server »"
            } else {
                errorMessage = "Réponse inattendue du serveur : \(error.localizedDescription)"
            }
        }
    }
}
