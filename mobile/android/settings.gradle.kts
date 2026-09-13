pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    // Contournement d'un bug reproductible de Gradle 9.1.0 dans cet
    // environnement (MergeInstrumentationAnalysisTransform : échec de
    // désérialisation dès la résolution du classpath du plugin AGP
    // lui-même, avant même d'atteindre les dépendances de l'app — persiste
    // après un cache Gradle entièrement vidé, donc pas une corruption locale).
    // AGP 9.0.1 exige Gradle ≥ 9.1.0 ; repli sur une paire AGP/Kotlin plus
    // ancienne compatible avec Gradle 8.14 (voir gradle-wrapper.properties),
    // déjà éprouvée sur cette machine (caches Gradle 8.x préexistants).
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
    // Notifications push mobiles (voir FcmProvider côté backend) — appliqué
    // seulement si android/app/google-services.json existe (voir
    // app/build.gradle.kts) : sans ce fichier, `apply false` ici suffit à
    // déclarer le plugin disponible sans jamais le déclencher, donc jamais
    // d'échec de build tant que Firebase n'est pas configuré.
    id("com.google.gms.google-services") version "4.4.2" apply false
}

include(":app")
