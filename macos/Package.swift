// swift-tools-version:5.9
import PackageDescription

// Core = logique sans interface (décodage, libellés, filtre) : c'est la partie testée.
// Widget = l'application (AppKit + SwiftUI), qui dépend de Core.
let package = Package(
    name: "ClaudeRenderWidget",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ClaudeRenderCore"),
        .executableTarget(name: "ClaudeRenderWidget", dependencies: ["ClaudeRenderCore"]),
        .testTarget(name: "ClaudeRenderCoreTests", dependencies: ["ClaudeRenderCore"]),
    ]
)
