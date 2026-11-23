# Claude Render

🇫🇷 [Version française](README.fr.md)

A **local** web app that visualizes Claude Code's work from its session transcripts
(`~/.claude/projects/**/*.jsonl`). Nothing leaves your machine: the server only listens on `127.0.0.1`.

Two views:
- **Timeline** in swimlanes (main agent + one lane per subagent), with dependencies drawn as arrows;
- **Metrics**: duration, tokens, estimated cost, breakdown by tool and by agent, thinking vs. acting time, errors, repeated calls.

![Timeline with subagent lanes and dependency arrows](docs/screenshots/timeline.png)

*Timeline: one lane per (nested) subagent, spans colored by tool category, `spawn` (orange) and `result` (blue) arrows, minimap at the bottom.*

| Span details | Metrics for a selected time range |
|---|---|
| ![Span details panel](docs/screenshots/span-detail.png) | ![Metrics panel](docs/screenshots/metrics.png) |

> Screenshots use the built-in demo data (no real session is shown). The UI is in French.

## Install and run

Requirements: Node 20+ (tested with Node 26).

```bash
npm install
npm run dev        # server (http://127.0.0.1:3001) + UI (http://localhost:5173)
```

Other commands:

```bash
npm test           # vitest tests
npm run typecheck  # TypeScript check
npm run build      # build the front end into dist/client (then served by the Express server)
```

Environment variables: `PORT` (default 3001), `CLAUDE_PROJECTS_DIR` (default `~/.claude/projects`).

## Usage

- Pick a session at the top (sorted by date).
- Mouse wheel = zoom, drag = pan, **Shift + drag** = select a time range (the metrics follow it).
- Click a block for its details on the right; click a lane name to filter the metrics on that subagent.
- Subagent lanes can be collapsed (▸/▾).

## macOS widget (optional)

A small native floating widget, top-right of the main display, summarizes active sessions: project, finished/launched subagents, last action, age.

<img src="docs/screenshots/widget.png" alt="macOS widget listing three active sessions" width="300">

- Click a row to open the detailed view on that session (`http://127.0.0.1:3001/?session=<id>`).
- The pencil (✎) lets you pick which sessions to follow (none picked = show all).
- The menu bar icon shows/hides the widget. Its menu also has **"Ouvrir la page à chaque nouvelle session"** (off by default): every newly started Claude session then opens its detailed page.

```bash
npm run dev:server                 # the server must be running (port 3001)
cd macos && swift run ClaudeRenderWidget
cd macos && swift test             # Core tests
```

`CLAUDE_RENDER_URL` changes the server address. Requires macOS 13+, Swift 5.9+.

## Structure

```
src/shared/types.ts   data model (Session, Lane, Span, Dependency, Metrics...)
src/shared/metrics.ts metrics computation (pure function, used on the client side)
src/server/parser.ts  JSONL -> Session parser (tested)
src/server/sessions.ts, index.ts   session listing / loading, Express API
src/client/           React UI (timeline/ = hand-made SVG, d3-scale for the scales only)
config/pricing.json   price table per model (to adjust, see below)
src/server/live.ts    active sessions summary (for the widget)
tests/                vitest tests + hand-written fixtures
macos/                native Swift widget (Core = testable logic, Widget = AppKit/SwiftUI UI)
```

API: `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/pricing`, `GET /api/live`.

## Estimated cost

Transcripts do **not** contain the cost in dollars. It is computed from `config/pricing.json`
(dollars per million tokens, per model prefix). **The provided values are examples**:
check and adjust them before relying on them.

## Known limitations (caused by the data)

- **Thinking content is unavailable**: `thinking` blocks are empty in the transcripts. Only their duration
  (`thinkingDurationMs`) and token count are known, so thinking cards show no text.
- **Approximate durations**: a line has a single timestamp. A tool lasts from its `tool_use` to its `tool_result`;
  a text block is estimated from the previous line; the position of a thinking block is derived from its duration.
- **Background subagents**: their real end comes from a `task-notification` sent to the parent. If it is missing
  from the transcript, the agent stays shown as "running" rather than inventing an end.
- **Synchronous subagents**: not observed in the transcripts used to write the parser (all were asynchronous);
  their handling is not verified on real data.
- **`data` dependencies**: a file written (Write/Edit) then read (Read) later. This is a heuristic on file paths:
  nothing proves the read actually used the written data. A write is only linked to the first read that follows.
- **Tokens**: usage is copied onto every line of the same API request; it is counted once per request
  (carried by its first span). On a narrow time range, the cost may therefore be attributed to a different interval
  than the actual call.
- **Undocumented format**: the transcript format may change with Claude Code versions.
- Visual rendering was checked on Chromium (screenshots) and unit tests, not on Safari or Firefox.
  Smooth up to ~20,000 spans in headless Chromium (no frame over 50 ms); the real sessions measured had about 1,000 spans.

## License

MIT
