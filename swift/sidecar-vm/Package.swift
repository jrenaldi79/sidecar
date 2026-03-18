// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "sidecar-vm",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "sidecar-vm",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("Virtualization")
            ]
        )
    ]
)
