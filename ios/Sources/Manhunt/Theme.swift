import SwiftUI
import UIKit

/// The web app's colours (src/index.css), for the few native screens
enum Theme {
    static let page = Color(pageUI)                 // --ink-1
    static let raised = Color(hex: 0x1a1e28)        // --ink-3
    static let hairline = Color(hex: 0xeef0f5, opacity: 0.08)
    static let text = Color(hex: 0xeef0f5)          // --text-1
    static let textSecondary = Color(hex: 0xa3a9b8) // --text-2
    static let textTertiary = Color(hex: 0x8990a2)  // --text-3
    static let accent = Color(hex: 0xff7b2c)
    static let onAccent = Color(hex: 0x11141c)
    static let negative = Color(hex: 0xeb656a)

    /// The page colour for UIKit views (the web view's backdrop)
    static let pageUI = UIColor(red: 0x0b / 255, green: 0x0d / 255, blue: 0x14 / 255, alpha: 1)
}

private extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: opacity
        )
    }
}
