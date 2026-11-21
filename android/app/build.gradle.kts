plugins {
    id("com.android.application")
}

// The game server the app shows: where the game is hosted (the repository's
// fly.toml). `-Pserver=name.example.com` builds a different one in, for
// trying the app against a test server (install.mjs --server does that).
// Only https works: the camera and compass need it.
val hostedServer = "https://manhunt.fly.dev"
val server = (findProperty("server") as String?)?.trim()?.takeIf { it.isNotEmpty() }
    ?.removeSuffix("/")?.let { if (it.startsWith("https://")) it else "https://$it" }
    ?: hostedServer
require(Regex("""https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+(:\d+)?""").matches(server)) {
    "-Pserver should be an https address like name.example.com, not \"$server\""
}

android {
    namespace = "com.manhunt.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.manhunt.android"
        // Android 8: adaptive icons, and a WebView new enough for the web app
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        buildConfigField("String", "SERVER", "\"$server\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.18.0")
    // Running a script before the page's own, and talking to the page
    implementation("androidx.webkit:webkit:1.18.0")
}
