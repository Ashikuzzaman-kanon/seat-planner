import java.net.URI
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
 * The live site the app shows. Every web deploy reaches the phone through it,
 * so changing the website never needs a new APK — only changing this does.
 */
val productionUrl = "https://seat-planner-sable.vercel.app"

/*
 * The release signing key, from android/keystore.properties on a developer's
 * machine or from environment variables in CI. Neither is in the repository.
 * Every release must be signed with the same key, or phones refuse to install
 * it over the one they have — see README.md, "The signing key".
 */
val keystore = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun signing(name: String, env: String): String? = keystore.getProperty(name) ?: System.getenv(env)

android {
    namespace = "com.seatplanner.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.seatplanner.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "PRODUCTION_URL", "\"$productionUrl\"")
        manifestPlaceholders["productionHost"] = URI(productionUrl).host
    }

    signingConfigs {
        val storeFile = signing("storeFile", "SIGNING_STORE_FILE")
        if (storeFile != null) {
            create("release") {
                this.storeFile = file(storeFile)
                storePassword = signing("storePassword", "SIGNING_STORE_PASSWORD")
                keyAlias = signing("keyAlias", "SIGNING_KEY_ALIAS")
                keyPassword = signing("keyPassword", "SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Unsigned when there is no key (a pull request from a fork, say).
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")

    testImplementation("junit:junit:4.13.2")
}
