import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Jamais commité (voir android/.gitignore) — absent en CI/clone frais tant
// qu'on n'y a pas généré/copié un vrai keystore de production ; le build
// release retombe alors sur les clés de debug plutôt que d'échouer, pour ne
// jamais bloquer un simple `flutter build apk --debug`.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.glotta.glotta_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Requis par flutter_local_notifications (APIs Java 8+ pour la
        // planification de notifications) — sans ça, checkDebugAarMetadata
        // échoue au build même en debug.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.glotta.glotta_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // Retombe sur les clés de debug si aucun keystore de production n'a
            // été généré (voir hasReleaseSigning ci-dessus) — un vrai APK à
            // distribuer/publier doit toujours utiliser signingConfigs["release"].
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// Notifications push mobiles (FCM, voir FcmProvider côté backend et
// notification_service.dart côté Flutter) — appliqué seulement si le
// fichier existe (voir settings.gradle.kts, plugin déclaré "apply false"
// juste pour ça) : un clone frais sans google-services.json continue de
// compiler normalement, Firebase reste simplement non initialisé au
// runtime (voir NotificationService.init, qui gère cet échec proprement).
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
