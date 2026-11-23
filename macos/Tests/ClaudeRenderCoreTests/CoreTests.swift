import XCTest
@testable import ClaudeRenderCore

final class CoreTests: XCTestCase {
    private func make(id: String = "a", project: String = "/Users/moi/Code/X", start: Double = 0, last: Double = 0,
                      total: Int = 0, running: Int = 0, action: String = "", tool: String? = nil) -> LiveSession {
        LiveSession(id: id, project: project, start: start, lastActivity: last, agentsTotal: total,
                    agentsRunning: running, agentsDone: total - running, hasRunningSpan: running > 0,
                    lastAction: action, lastTool: tool)
    }

    func testDecodeServerJSON() throws {
        let json = """
        [{"id":"abc","project":"/p/X","start":1000,"lastActivity":2000,"agentsTotal":3,"agentsRunning":1,
          "agentsDone":2,"hasRunningSpan":true,"lastAction":"npm test","lastTool":"Bash"},
         {"id":"def","project":"/p/Y","start":1,"lastActivity":2,"agentsTotal":0,"agentsRunning":0,
          "agentsDone":0,"hasRunningSpan":false,"lastAction":""}]
        """
        let list = try decodeLive(Data(json.utf8))
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].lastTool, "Bash")
        XCTAssertNil(list[1].lastTool) // champ absent du JSON : doit rester nil, pas planter
    }

    func testDecodeRejectsGarbage() {
        XCTAssertThrowsError(try decodeLive(Data("pas du json".utf8)))
    }

    func testStateUsesLastActivity() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertEqual(make(last: 9_950_000).state(now: now), .active) // 50 s
        XCTAssertEqual(make(last: 9_000_000).state(now: now), .waiting) // 1000 s
        XCTAssertEqual(make(last: 20_000_000).state(now: now), .active) // dans le futur : pas de crash
    }

    func testLabels() {
        let now = Date(timeIntervalSince1970: 4_000)
        let s = make(start: 0, last: 3_990_000, total: 3, running: 1, action: "npm test\nsuite", tool: "Bash")
        XCTAssertEqual(s.projectName, "X")
        XCTAssertEqual(s.agentsLabel, "2/3 agents")
        XCTAssertEqual(s.actionLabel, "Bash · npm test suite")
        XCTAssertEqual(s.ageLabel(now: now), "il y a 10 s")
        XCTAssertEqual(s.elapsedLabel(now: now), "1 h 06")
        XCTAssertNil(make().agentsLabel)
        XCTAssertEqual(make().actionLabel, "—")
    }

    func testVisibleSessions() {
        let all = [make(id: "a"), make(id: "b")]
        XCTAssertEqual(visibleSessions(all, followed: []).count, 2) // rien choisi : tout
        XCTAssertEqual(visibleSessions(all, followed: ["b"]).map(\.id), ["b"])
        XCTAssertEqual(visibleSessions(all, followed: ["zzz"]).count, 0) // suivie mais plus active
    }

    func testSessionsToAutoOpen() {
        let all = [make(id: "a"), make(id: "b")]
        XCTAssertEqual(sessionsToAutoOpen(known: [], current: [], followed: []).count, 0) // liste vide
        XCTAssertEqual(sessionsToAutoOpen(known: ["a"], current: all, followed: []).map(\.id), ["b"]) // b est neuve
        XCTAssertEqual(sessionsToAutoOpen(known: ["a", "b"], current: all, followed: []).count, 0) // déjà connues
        XCTAssertEqual(sessionsToAutoOpen(known: ["a"], current: all, followed: ["a"]).count, 0) // filtre actif : b masquée
    }

    func testURLs() {
        XCTAssertEqual(serverURL(from: [:]), defaultServerURL)
        XCTAssertEqual(serverURL(from: ["CLAUDE_RENDER_URL": "n'importe quoi"]), defaultServerURL)
        XCTAssertEqual(serverURL(from: ["CLAUDE_RENDER_URL": "http://localhost:5173"]).port, 5173)
        XCTAssertEqual(detailURL(server: defaultServerURL, sessionId: "abc")?.absoluteString,
                       "http://127.0.0.1:3001?session=abc")
    }

    // Session de 0 à 100 s, observée à t = 100 s : les x valent donc secondes / 100.
    private func layout(_ agents: [LiveAgent], last: Double = 100_000) -> BranchLayout {
        let s = LiveSession(id: "a", project: "/p", start: 0, lastActivity: last, agentsTotal: agents.count,
                            agentsRunning: 0, agentsDone: agents.count, hasRunningSpan: false, lastAction: "",
                            lastTool: nil, agents: agents)
        return branchLayout(s, now: Date(timeIntervalSince1970: 100))
    }

    private func agent(_ id: String, _ start: Double, _ end: Double, parent: String = "main",
                       running: Bool = false) -> LiveAgent {
        LiveAgent(id: id, parentId: parent, name: id, start: start * 1000, end: end * 1000, running: running)
    }

    func testDecodeAgents() throws {
        let json = """
        [{"id":"abc","project":"/p","start":0,"lastActivity":1,"agentsTotal":1,"agentsRunning":0,"agentsDone":1,
          "hasRunningSpan":false,"lastAction":"","agents":[{"id":"x","parentId":"main","name":"n","start":0,
          "end":1,"running":false}]}]
        """
        XCTAssertEqual(try decodeLive(Data(json.utf8))[0].agents.map(\.id), ["x"])
    }

    func testLayoutWithoutAgents() {
        let l = layout([], last: 50_000)
        XCTAssertEqual(l.trackCount, 0)
        XCTAssertEqual(l.mainEnd, 0.5, accuracy: 1e-9) // dernière activité à mi-chemin de maintenant
    }

    func testSequentialAgentsShareATrack() {
        let l = layout([agent("a", 10, 20), agent("b", 40, 50)])
        XCTAssertEqual(l.branches.map(\.track), [1, 1])
        XCTAssertEqual(l.trackCount, 1)
        XCTAssertEqual(l.branches[0].x0, 0.1, accuracy: 1e-9)
        XCTAssertEqual(l.branches[0].x1, 0.2, accuracy: 1e-9)
    }

    func testOverlappingAgentsStack() {
        let l = layout([agent("b", 15, 30), agent("a", 10, 40), agent("c", 35, 60)])
        // triés par début : a (piste 1), b chevauche a (piste 2), c chevauche a mais plus b (piste 2)
        XCTAssertEqual(l.branches.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(l.branches.map(\.track), [1, 2, 2])
    }

    func testNestedAgentGoesBelowItsParent() {
        let l = layout([agent("p", 10, 80), agent("q", 20, 30), agent("child", 50, 60, parent: "q")])
        let child = l.branches.first { $0.id == "child" }!
        XCTAssertEqual(child.parentTrack, 2) // q est en piste 2 (chevauche p)
        XCTAssertEqual(child.track, 3) // même si la piste 2 est libre à 50 s : on reste sous le parent
    }

    func testTracksAreCapped() {
        let many = (0..<10).map { agent("a\($0)", Double($0), 90) }
        let l = layout(many)
        XCTAssertEqual(l.trackCount, maxBranchTracks)
        XCTAssertTrue(l.branches.allSatisfy { $0.track <= maxBranchTracks })
    }

    func testRunningAgentStopsAtLastActivityAndTinyAgentIsVisible() {
        let l = layout([agent("r", 10, 100, running: true), agent("t", 50, 50)], last: 70_000)
        XCTAssertEqual(l.branches[0].x1, 0.7, accuracy: 1e-9)
        XCTAssertEqual(l.branches[1].x1 - l.branches[1].x0, minBranchFraction, accuracy: 1e-9)
    }

    func testLayoutAtSessionStartDoesNotCrash() {
        let s = LiveSession(id: "a", project: "/p", start: 5000, lastActivity: 5000, agentsTotal: 0, agentsRunning: 0,
                            agentsDone: 0, hasRunningSpan: false, lastAction: "", lastTool: nil)
        XCTAssertEqual(branchLayout(s, now: Date(timeIntervalSince1970: 5)).mainEnd, 0)
    }
}
