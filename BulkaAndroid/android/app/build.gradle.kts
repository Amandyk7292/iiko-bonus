import java.io.File
import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
// Read an existing private configuration in place when building from a clean
// worktree. Passwords and the keystore do not need to be copied into the checkout.
val keystorePropertiesFile = rootProject.file(
    providers.environmentVariable("BULKA_ANDROID_SIGNING_PROPERTIES_FILE")
        .getOrElse("key.properties"),
)
if (keystorePropertiesFile.isFile) {
    FileInputStream(keystorePropertiesFile).use(keystoreProperties::load)
}
val hasReleaseSigning = listOf("keyAlias", "keyPassword", "storeFile", "storePassword")
    .all { !keystoreProperties.getProperty(it).isNullOrBlank() }

android {
    namespace = "com.bulka.bonus"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.bulka.bonus"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = keystoreProperties.getProperty("storeFile")?.let { path ->
                    File(path).let { file ->
                        if (file.isAbsolute) file else File(keystorePropertiesFile.parentFile, path)
                    }
                }
                storePassword = keystoreProperties.getProperty("storePassword")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

gradle.taskGraph.whenReady {
    val buildsReleaseArtifact = allTasks.any { task ->
        task.name.contains("release", ignoreCase = true) &&
            (task.name.contains("assemble", ignoreCase = true) ||
                task.name.contains("bundle", ignoreCase = true) ||
                task.name.contains("package", ignoreCase = true))
    }
    if (buildsReleaseArtifact && !hasReleaseSigning) {
        throw GradleException(
            "Release signing is not configured. Configure android/key.properties or set " +
                "BULKA_ANDROID_SIGNING_PROPERTIES_FILE to an existing release configuration.",
        )
    }
}

flutter {
    source = "../.."
}
