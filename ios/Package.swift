// swift-tools-version: 6.0

import PackageDescription

// The iOS app: a native shell around the Manhunt web app, built with xtool
// (https://xtool.sh) so it needs no Mac. See README.md in this folder.
let package = Package(
    name: "Manhunt",
    platforms: [
        .iOS(.v16),
    ],
    products: [
        // xtool turns a package's one library product into the app
        .library(
            name: "Manhunt",
            targets: ["Manhunt"]
        ),
    ],
    targets: [
        .target(
            name: "Manhunt",
            resources: [.process("Resources")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
