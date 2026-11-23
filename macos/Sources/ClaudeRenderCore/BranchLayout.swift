import Foundation

// Mise en page du graphe de branches du widget : la session est une ligne (piste 0), chaque sous-agent
// une branche qui part de la piste de son parent et y revient. Les x sont des fractions 0...1 de la
// largeur, de session.start (0) à maintenant (1), pour que la vue n'ait plus qu'à multiplier.

public struct Branch: Equatable {
    public let id: String
    public let name: String
    public let track: Int // 1, 2, … (0 = ligne principale)
    public let parentTrack: Int
    public let x0: Double
    public let x1: Double
    public let running: Bool
}

public struct BranchLayout: Equatable {
    public let mainEnd: Double // x de la dernière activité : la ligne principale s'arrête là
    public let branches: [Branch]
    public let trackCount: Int // pistes de branches utilisées (0 = aucun agent), pour la hauteur
}

// Au-delà, les branches se superposent sur la dernière piste : le widget doit rester petit.
public let maxBranchTracks = 4
// Largeur minimale d'une branche, et écart minimal entre deux branches d'une même piste,
// sinon un agent de 2 s dans une session de 2 h serait invisible ou collé au suivant.
public let minBranchFraction = 0.03

public func branchLayout(_ session: LiveSession, now: Date) -> BranchLayout {
    let nowMs = max(now.timeIntervalSince1970 * 1000, session.lastActivity)
    let duration = max(nowMs - session.start, 1) // évite la division par zéro au tout début
    func x(_ ms: Double) -> Double { min(1, max(0, (ms - session.start) / duration)) }

    let mainEnd = x(session.lastActivity)
    var trackOf: [String: Int] = ["main": 0]
    var busyUntil: [Double] = [] // busyUntil[t - 1] = x de fin du dernier agent posé sur la piste t
    var branches: [Branch] = []

    for agent in session.agents.sorted(by: { $0.start < $1.start }) {
        let x0 = x(agent.start)
        // Un agent "running" s'arrête à la dernière activité, pas à maintenant : le serveur peut garder
        // à tort un agent en cours (voir parser.ts), et une session endormie ne doit pas pousser de branche.
        let rawEnd = agent.running ? mainEnd : x(agent.end)
        let x1 = min(1, max(rawEnd, x0 + minBranchFraction))

        let parentTrack = trackOf[agent.parentId] ?? 0
        var track = parentTrack + 1
        while track <= busyUntil.count && busyUntil[track - 1] + minBranchFraction > x0 {
            track += 1
        }
        track = min(track, maxBranchTracks)
        while busyUntil.count < track { busyUntil.append(-1) }
        busyUntil[track - 1] = max(busyUntil[track - 1], x1)
        trackOf[agent.id] = track

        branches.append(Branch(id: agent.id, name: agent.name, track: track, parentTrack: min(parentTrack, track),
                               x0: x0, x1: x1, running: agent.running))
    }
    return BranchLayout(mainEnd: mainEnd, branches: branches, trackCount: busyUntil.count)
}
