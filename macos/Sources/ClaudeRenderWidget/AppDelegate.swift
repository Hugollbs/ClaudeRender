import AppKit
import ClaudeRenderCore
import Combine
import SwiftUI

// Panneau sans bordure, toujours au-dessus, qui ne vole pas le focus à l'application en cours.
final class FloatingPanel: NSPanel {
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        level = .floating
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = true // on peut le déplacer en glissant le fond
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary] // visible sur tous les bureaux
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let serverURL = ClaudeRenderCore.serverURL(from: ProcessInfo.processInfo.environment)
    private lazy var store = LiveStore(client: LiveClient(server: serverURL))
    private let panel = FloatingPanel()
    private var statusItem: NSStatusItem?
    private var hostingView: NSHostingView<WidgetView>?
    private var cancellable: AnyCancellable?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let view = WidgetView(store: store) { [weak self] session in self?.openDetail(session) }
        let hosting = NSHostingView(rootView: view)
        hostingView = hosting
        panel.contentView = hosting

        // Chaque changement de contenu peut changer la hauteur : on redimensionne ensuite (async),
        // une fois que SwiftUI a fini de recalculer sa mise en page.
        cancellable = store.objectWillChange.sink { [weak self] in
            DispatchQueue.main.async { self?.resizeAndAnchor() }
        }

        makeStatusItem()
        resizeAndAnchor(reposition: true)
        panel.orderFrontRegardless()
        store.start()
    }

    // Garde le coin haut-droit fixe quand la hauteur change ; place en haut à droite au premier appel.
    private func resizeAndAnchor(reposition: Bool = false) {
        guard let hosting = hostingView else { return }
        let size = hosting.fittingSize
        var origin = panel.frame.origin
        var topRight = NSPoint(x: panel.frame.maxX, y: panel.frame.maxY)
        if reposition || panel.frame.isEmpty, let screen = NSScreen.main {
            let area = screen.visibleFrame // exclut la barre de menus
            topRight = NSPoint(x: area.maxX - 12, y: area.maxY - 12)
        }
        origin = NSPoint(x: topRight.x - size.width, y: topRight.y - size.height)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
    }

    private func makeStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "waveform.path.ecg", accessibilityDescription: "Claude Render")
        let menu = NSMenu()
        menu.addItem(withTitle: "Afficher / masquer le widget", action: #selector(togglePanel), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Ouvrir la version détaillée", action: #selector(openHome), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quitter", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    @objc private func togglePanel() {
        if panel.isVisible { panel.orderOut(nil) } else { panel.orderFrontRegardless() }
    }

    @objc private func openHome() {
        NSWorkspace.shared.open(serverURL)
    }

    private func openDetail(_ session: LiveSession) {
        if let url = detailURL(server: serverURL, sessionId: session.id) { NSWorkspace.shared.open(url) }
    }
}
