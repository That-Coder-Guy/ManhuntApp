plugins {
    id("com.android.application")
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
