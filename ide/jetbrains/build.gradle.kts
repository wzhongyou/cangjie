plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.0"
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "com.cangjie"
version = "0.2.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        bundledPlugin("org.jetbrains.plugins.terminal")
        pluginVerifier()
    }
}

intellijPlatform {
    buildSearchableOptions = false
    pluginConfiguration {
        name = "Cangjie"
        id = "com.cangjie.agent"
        description = "TUI Coding Agent — JetBrains 内 AI 代码助手"
        vendor { name = "Cangjie Team"; url = "https://github.com/wzhongyou/cangjie" }

        ideaVersion {
            sinceBuild = "243"
            untilBuild = "999.*"
        }
    }
}

tasks {
    patchPluginXml {
        sinceBuild = "243"
        untilBuild = "999.*"
    }
}
