import Foundation

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

    public init(id: String, project: String, start: Double, lastActivity: Double, agentsTotal: Int,
                agentsRunning: Int, agentsDone: Int, hasRunningSpan: Bool, lastAction: String, lastTool: String?) {
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
    }
}
