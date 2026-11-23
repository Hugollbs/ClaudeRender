import AppKit

// Point d'entrée : application "accessoire" = pas d'icône dans le Dock, pas de menu de barre.
// Le code de main.swift tourne sur le thread principal : assumeIsolated l'indique au compilateur
// (sinon il refuse de créer un objet @MainActor ici).
MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = AppDelegate()
    app.delegate = delegate // NSApplication ne retient pas son delegate : la closure le garde en vie via app.run()
    app.run()
}
