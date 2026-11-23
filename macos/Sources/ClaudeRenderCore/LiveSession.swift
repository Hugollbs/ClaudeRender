import Foundation

// Miroir de `LiveAgent` (src/shared/types.ts) : un sous-agent, dessiné comme une branche.
public struct LiveAgent: Codable, Identifiable, Equatable {
    public let id: String
    public let parentId: String // "main" ou l'id de l'agent qui l'a lancé
    public let name: String
    public let start: Double // ms
    public let end: Double // ms
    public let running: Bool

    public init(id: String, parentId: String, name: String, start: Double, end: Double, running: Bool) {
        self.id = id
        self.parentId = parentId
        self.name = name
        self.start = start
        self.end = end
        self.running = running
    }
}

// Miroir Swift du type `LiveSession` de src/shared/types.ts (réponse de GET /api/live).
// Les noms des propriétés doivent rester identiques à ceux du JSON.
public struct LiveSession: Codable, Identifiable, Equatable {
    public let id: String
    public let project: String
    public let start: Double // ms depuis l'époque Unix
    public let lastActivity: Double // ms depuis l'époque Unix
    public let agentsTotal: Int
    public let agentsRunning: Int
    public let agentsDone: Int
    public let hasRunningSpan: Bool
    public let lastAction: String
    public let lastTool: String?
    public let agents: [LiveAgent]

    public init(id: String, project: String, start: Double, lastActivity: Double, agentsTotal: Int,
                agentsRunning: Int, agentsDone: Int, hasRunningSpan: Bool, lastAction: String, lastTool: String?,
                agents: [LiveAgent] = []) {
        self.id = id
        self.project = project
        self.start = start
        self.lastActivity = lastActivity
        self.agentsTotal = agentsTotal
        self.agentsRunning = agentsRunning
        self.agentsDone = agentsDone
        self.hasRunningSpan = hasRunningSpan
        self.lastAction = lastAction
        self.lastTool = lastTool
        self.agents = agents
    }

    private enum CodingKeys: String, CodingKey {
        case id, project, start, lastActivity, agentsTotal, agentsRunning, agentsDone, hasRunningSpan, lastAction,
             lastTool, agents
    }

    // Décodage écrit à la main pour un seul champ : `agents` absent (serveur plus ancien) = liste vide,
    // au lieu de faire échouer toute la réponse.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        project = try c.decode(String.self, forKey: .project)
        start = try c.decode(Double.self, forKey: .start)
        lastActivity = try c.decode(Double.self, forKey: .lastActivity)
        agentsTotal = try c.decode(Int.self, forKey: .agentsTotal)
        agentsRunning = try c.decode(Int.self, forKey: .agentsRunning)
        agentsDone = try c.decode(Int.self, forKey: .agentsDone)
        hasRunningSpan = try c.decode(Bool.self, forKey: .hasRunningSpan)
        lastAction = try c.decode(String.self, forKey: .lastAction)
        lastTool = try c.decodeIfPresent(String.self, forKey: .lastTool)
        agents = try c.decodeIfPresent([LiveAgent].self, forKey: .agents) ?? []
    }
}
