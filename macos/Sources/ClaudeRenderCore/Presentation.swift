import Foundation

public enum ActivityState: Equatable {
    case active // le transcript a été écrit très récemment
    case waiting // plus d'écriture depuis un moment (réflexion longue, commande lente, ou fini)
}

// Seuil en secondes. On ne se fie pas à `hasRunningSpan` : un sous-agent lancé en arrière-plan
// sans notification de fin reste "running" pour toujours côté serveur (voir parser.ts).
public let activeWindowSeconds: Double = 90

// Adresse du serveur ClaudeRender (variable d'environnement CLAUDE_RENDER_URL pour la changer).
public let defaultServerURL = URL(string: "http://127.0.0.1:3001")!

public func serverURL(from environment: [String: String]) -> URL {
    guard let raw = environment["CLAUDE_RENDER_URL"], let url = URL(string: raw), url.scheme != nil, url.host != nil else {
        return defaultServerURL
    }
    return url
}

// Lien vers la version détaillée (la page web) sur une session précise.
public func detailURL(server: URL, sessionId: String) -> URL? {
    guard var components = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return nil }
    components.queryItems = [URLQueryItem(name: "session", value: sessionId)]
    return components.url
}

// Si l'utilisateur n'a rien choisi, on montre tout ; sinon seulement les sessions suivies.
public func visibleSessions(_ sessions: [LiveSession], followed: Set<String>) -> [LiveSession] {
    followed.isEmpty ? sessions : sessions.filter { followed.contains($0.id) }
}

extension LiveSession {
    private func seconds(since ms: Double, now: Date) -> Double {
        max(0, now.timeIntervalSince1970 - ms / 1000)
    }

    public func state(now: Date) -> ActivityState {
        seconds(since: lastActivity, now: now) <= activeWindowSeconds ? .active : .waiting
    }

    // Dernier dossier du chemin : "/Users/moi/Code/X" -> "X".
    public var projectName: String {
        let name = (project as NSString).lastPathComponent
        return name.isEmpty ? project : name
    }

    // "2/3 agents" (terminés / lancés) ; nil s'il n'y a pas de sous-agent.
    public var agentsLabel: String? {
        agentsTotal == 0 ? nil : "\(agentsDone)/\(agentsTotal) agents"
    }

    public var actionLabel: String {
        let text = lastAction.replacingOccurrences(of: "\n", with: " ")
        guard let tool = lastTool, !tool.isEmpty else { return text.isEmpty ? "—" : text }
        return text.isEmpty ? tool : "\(tool) · \(text)"
    }

    // "à l'instant", "il y a 45 s", "il y a 3 min", "il y a 2 h".
    public func ageLabel(now: Date) -> String {
        let s = Int(seconds(since: lastActivity, now: now))
        if s < 5 { return "à l'instant" }
        if s < 60 { return "il y a \(s) s" }
        if s < 3600 { return "il y a \(s / 60) min" }
        return "il y a \(s / 3600) h"
    }

    // Durée depuis le début de la session : "12 min", "1 h 05".
    public func elapsedLabel(now: Date) -> String {
        let minutes = Int(seconds(since: start, now: now)) / 60
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) h " + String(format: "%02d", minutes % 60)
    }
}
