import ClaudeRenderCore
import Foundation

// État observé par la vue : liste des sessions actives + sessions suivies.
// @MainActor : tout est modifié sur le thread principal, SwiftUI peut donc lire sans verrou.
@MainActor
final class LiveStore: ObservableObject {
    private static let followedKey = "followedSessionIds"
    private static let autoOpenKey = "autoOpenNewSessions"
    private static let pollInterval: UInt64 = 2_000_000_000 // 2 s, en nanosecondes

    @Published private(set) var sessions: [LiveSession] = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var followed: Set<String>
    // Dans le store (et non en @State de la vue) pour que le panneau soit redimensionné au changement de mode.
    @Published var choosing = false

    let client: LiveClient
    // Appelé pour chaque session apparue depuis le dernier poll (si l'ouverture auto est activée).
    var onNewSession: ((LiveSession) -> Void)?
    private var pollTask: Task<Void, Never>?
    // nil tant que le 1er poll n'a pas répondu : il sert à mémoriser les sessions déjà actives
    // au lancement du widget, sinon on ouvrirait une page pour chacune d'elles.
    private var knownIds: Set<String>?

    // Désactivé par défaut : ouvrir le navigateur à chaque lancement de `claude` est intrusif.
    var autoOpen: Bool {
        get { UserDefaults.standard.bool(forKey: Self.autoOpenKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.autoOpenKey) }
    }

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
            let fetched = try await client.fetchLive()
            if let known = knownIds, autoOpen {
                sessionsToAutoOpen(known: known, current: fetched, followed: followed).forEach { onNewSession?($0) }
            }
            knownIds = (knownIds ?? []).union(fetched.map(\.id))
            sessions = fetched
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
