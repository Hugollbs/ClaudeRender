import Foundation

public enum LiveClientError: Error, LocalizedError {
    case badStatus(Int)

    public var errorDescription: String? {
        switch self {
        case .badStatus(let code): return "Le serveur a répondu \(code)"
        }
    }
}

// Interroge GET /api/live. Le serveur doit déjà tourner (npm run dev:server).
public struct LiveClient {
    public let server: URL
    private let session: URLSession

    public init(server: URL) {
        self.server = server
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 3 // le widget ne doit pas rester bloqué si le serveur est figé
        self.session = URLSession(configuration: config)
    }

    public func fetchLive() async throws -> [LiveSession] {
        let (data, response) = try await session.data(from: server.appendingPathComponent("api/live"))
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw LiveClientError.badStatus(http.statusCode)
        }
        return try decodeLive(data)
    }
}

public func decodeLive(_ data: Data) throws -> [LiveSession] {
    try JSONDecoder().decode([LiveSession].self, from: data)
}
