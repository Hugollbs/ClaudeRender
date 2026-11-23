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

    func testURLs() {
        XCTAssertEqual(serverURL(from: [:]), defaultServerURL)
        XCTAssertEqual(serverURL(from: ["CLAUDE_RENDER_URL": "n'importe quoi"]), defaultServerURL)
        XCTAssertEqual(serverURL(from: ["CLAUDE_RENDER_URL": "http://localhost:5173"]).port, 5173)
        XCTAssertEqual(detailURL(server: defaultServerURL, sessionId: "abc")?.absoluteString,
                       "http://127.0.0.1:3001?session=abc")
    }
}
