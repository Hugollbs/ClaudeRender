import AppKit
import ClaudeRenderCore
import SwiftUI

let widgetWidth: CGFloat = 300
let widgetPadding: CGFloat = 10

struct WidgetView: View {
    @ObservedObject var store: LiveStore
    let openDetail: (LiveSession) -> Void

    var body: some View {
        // TimelineView relance le calcul toutes les secondes pour que « il y a 10 s » avance seul.
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 6) {
                header
                if let message = store.errorMessage {
                    Text(message).font(.caption).foregroundStyle(.orange)
                }
                let rows = store.choosing ? store.sessions : store.visible
                if rows.isEmpty && store.errorMessage == nil {
                    Text(emptyText).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(rows) { session in
                    if store.choosing {
                        row(session, now: context.date)
                    } else {
                        graphRow(session, now: context.date)
                    }
                }
            }
            .padding(widgetPadding)
            .frame(width: widgetWidth, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var emptyText: String {
        store.sessions.isEmpty ? "Aucune session active" : "Aucune session suivie active (✎ pour choisir)"
    }

    private var header: some View {
        HStack {
            // Étiquette discrète : le graphe doit rester l'élément principal.
            Text("CLAUDE RENDER").font(.system(size: 9, weight: .semibold)).tracking(1.2)
                .foregroundStyle(.tertiary)
            Spacer()
            Button(store.choosing ? "OK" : "✎") { store.choosing.toggle() }
                .buttonStyle(.plain)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .help("Choisir les sessions à suivre")
        }
    }

    // Vue normale : nom + durée, puis le graphe de branches. Le détail texte passe dans l'infobulle.
    private func graphRow(_ session: LiveSession, now: Date) -> some View {
        let active = session.state(now: now) == .active
        let runningAgents = active ? session.agents.filter(\.running).count : 0
        return VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(session.projectName).font(.caption2.weight(.semibold)).lineLimit(1)
                    .foregroundStyle(active ? .primary : .secondary)
                if runningAgents > 0 {
                    Label("\(runningAgents)", systemImage: "arrow.triangle.branch")
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(BranchPalette.color(track: 1))
                }
                Spacer()
                Text(session.elapsedLabel(now: now)).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
            }
            BranchGraph(layout: branchLayout(session, now: now), active: active, width: graphWidth)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .help(tooltip(session, now: now))
        .onTapGesture { openDetail(session) }
    }

    private var graphWidth: CGFloat { widgetWidth - 2 * widgetPadding }

    private func tooltip(_ session: LiveSession, now: Date) -> String {
        var lines = [session.actionLabel, "\(session.ageLabel(now: now)) · \(session.elapsedLabel(now: now))"]
        if let agents = session.agentsLabel { lines.append(agents) }
        return lines.joined(separator: "\n")
    }

    private func row(_ session: LiveSession, now: Date) -> some View {
        let active = session.state(now: now) == .active
        return HStack(alignment: .top, spacing: 6) {
            if store.choosing {
                Image(systemName: store.followed.contains(session.id) ? "checkmark.square.fill" : "square")
                    .font(.caption)
            } else {
                Circle().fill(active ? Color.green : Color.gray).frame(width: 8, height: 8).padding(.top, 4)
            }
            VStack(alignment: .leading, spacing: 1) {
                HStack {
                    Text(session.projectName).font(.caption.bold()).lineLimit(1)
                    Spacer()
                    if let agents = session.agentsLabel {
                        Text(agents).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Text(session.actionLabel).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                Text("\(session.ageLabel(now: now)) · \(session.elapsedLabel(now: now))")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .opacity(active || store.choosing ? 1 : 0.6)
        .contentShape(Rectangle()) // toute la ligne est cliquable, pas seulement le texte
        .onTapGesture {
            if store.choosing { store.toggleFollow(session.id) } else { openDetail(session) }
        }
    }
}
