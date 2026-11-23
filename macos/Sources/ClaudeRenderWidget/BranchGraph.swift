import ClaudeRenderCore
import SwiftUI

// Couleurs : corail (teinte Claude) pour la ligne principale, puis une teinte par profondeur de piste.
enum BranchPalette {
    static let main = Color(red: 0.85, green: 0.47, blue: 0.34)
    private static let tracks: [Color] = [
        Color(red: 0.96, green: 0.65, blue: 0.36), // ambre
        Color(red: 0.93, green: 0.49, blue: 0.62), // rose
        Color(red: 0.66, green: 0.55, blue: 0.95), // lilas
        Color(red: 0.40, green: 0.75, blue: 0.85), // bleu-vert
    ]

    static func color(track: Int) -> Color {
        track == 0 ? main : tracks[(track - 1) % tracks.count]
    }
}

// Dimensions en points. Centralisées ici pour régler le rendu à un seul endroit.
private enum Metrics {
    static let topPadding: CGFloat = 5
    static let trackSpacing: CGFloat = 7
    static let bottomPadding: CGFloat = 5
    static let mainWidth: CGFloat = 2.5
    static let branchWidth: CGFloat = 1.6
    static let maxCurve: CGFloat = 9 // longueur horizontale max d'une courbe de départ / de retour
    static let headSize: CGFloat = 6
}

struct BranchGraph: View {
    let layout: BranchLayout
    let active: Bool
    let width: CGFloat

    private var height: CGFloat {
        Metrics.topPadding + CGFloat(layout.trackCount) * Metrics.trackSpacing + Metrics.bottomPadding
    }

    private func y(_ track: Int) -> CGFloat { Metrics.topPadding + CGFloat(track) * Metrics.trackSpacing }
    private func x(_ fraction: Double) -> CGFloat { CGFloat(fraction) * width }

    var body: some View {
        Canvas { context, _ in
            for branch in layout.branches { drawBranch(branch, in: &context) }
            drawMain(in: &context)
        }
        .frame(width: width, height: height)
        .overlay(alignment: .topLeading) { heads }
    }

    // Ligne principale : dégradé pâle → corail, puis pointillé discret si la session attend.
    private func drawMain(in context: inout GraphicsContext) {
        let end = max(x(layout.mainEnd), 1)
        var line = Path()
        line.move(to: CGPoint(x: 0, y: y(0)))
        line.addLine(to: CGPoint(x: end, y: y(0)))
        let gradient = Gradient(colors: [BranchPalette.main.opacity(0.15), BranchPalette.main.opacity(active ? 1 : 0.55)])
        context.stroke(line, with: .linearGradient(gradient, startPoint: .zero, endPoint: CGPoint(x: end, y: 0)),
                       style: StrokeStyle(lineWidth: Metrics.mainWidth, lineCap: .round))

        if !active && end < width - 2 {
            var trail = Path()
            trail.move(to: CGPoint(x: end + 4, y: y(0)))
            trail.addLine(to: CGPoint(x: width, y: y(0)))
            context.stroke(trail, with: .color(.secondary.opacity(0.35)),
                           style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [1, 4]))
        }
    }

    // Branche : courbe en S qui descend de la piste parente, palier, puis remonte (sauf si encore en cours).
    private func drawBranch(_ branch: Branch, in context: inout GraphicsContext) {
        let x0 = x(branch.x0), x1 = x(branch.x1)
        let yParent = y(branch.parentTrack), yTrack = y(branch.track)
        let curve = min(Metrics.maxCurve, (x1 - x0) / 2)
        let returns = !(branch.running && active)

        var path = Path()
        path.move(to: CGPoint(x: x0, y: yParent))
        addSCurve(to: &path, from: CGPoint(x: x0, y: yParent), to: CGPoint(x: x0 + curve, y: yTrack))
        if returns {
            path.addLine(to: CGPoint(x: x1 - curve, y: yTrack))
            addSCurve(to: &path, from: CGPoint(x: x1 - curve, y: yTrack), to: CGPoint(x: x1, y: yParent))
        } else {
            path.addLine(to: CGPoint(x: x1, y: yTrack))
        }

        let color = BranchPalette.color(track: branch.track)
        let gradient = Gradient(colors: [color.opacity(0.35), color.opacity(active ? 0.95 : 0.5)])
        context.stroke(path, with: .linearGradient(gradient, startPoint: CGPoint(x: x0, y: 0), endPoint: CGPoint(x: x1, y: 0)),
                       style: StrokeStyle(lineWidth: Metrics.branchWidth, lineCap: .round, lineJoin: .round))
    }

    // Courbe de Bézier cubique avec des points de contrôle horizontaux : départ et arrivée à plat.
    private func addSCurve(to path: inout Path, from a: CGPoint, to b: CGPoint) {
        let midX = (a.x + b.x) / 2
        path.addCurve(to: b, control1: CGPoint(x: midX, y: a.y), control2: CGPoint(x: midX, y: b.y))
    }

    // Têtes : un point au bout de chaque ligne encore vivante ; il pulse si la session est active.
    @ViewBuilder private var heads: some View {
        if active {
            PulsingHead(color: BranchPalette.main)
                .position(x: x(layout.mainEnd), y: y(0))
            ForEach(layout.branches.filter(\.running), id: \.id) { branch in
                PulsingHead(color: BranchPalette.color(track: branch.track), size: Metrics.headSize - 1.5)
                    .position(x: x(branch.x1), y: y(branch.track))
            }
        } else {
            Circle().strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1.2)
                .frame(width: Metrics.headSize, height: Metrics.headSize)
                .position(x: x(layout.mainEnd), y: y(0))
        }
    }
}

// Point plein + halo qui grandit et s'efface en boucle (animé par Core Animation, pas par le Canvas).
private struct PulsingHead: View {
    let color: Color
    var size: CGFloat = Metrics.headSize
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle().fill(color.opacity(0.45))
                .scaleEffect(pulse ? 2.6 : 1)
                .opacity(pulse ? 0 : 0.9)
            Circle().fill(color)
                .shadow(color: color.opacity(0.8), radius: 3)
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}
