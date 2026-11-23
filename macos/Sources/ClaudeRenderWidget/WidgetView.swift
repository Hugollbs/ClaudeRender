import AppKit
import ClaudeRenderCore
import SwiftUI

let widgetWidth: CGFloat = 300

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
                    row(session, now: context.date)
                }
            }
            .padding(10)
            .frame(width: widgetWidth, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var emptyText: String {
        store.sessions.isEmpty ? "Aucune session active" : "Aucune session suivie active (✎ pour choisir)"
    }

    private var header: some View {
        HStack {
            Text("Claude Render").font(.caption.bold())
            Spacer()
            Button(store.choosing ? "OK" : "✎") { store.choosing.toggle() }
                .buttonStyle(.plain)
                .font(.caption)
                .help("Choisir les sessions à suivre")
        }
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
