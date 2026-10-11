import com.android.build.gradle.internal.dsl.BaseAppModuleExtension
import java.security.MessageDigest
import java.util.zip.ZipInputStream

// Pinned LGPL build, no Flutter/Dart runtime or runtime downloads. See docs/android/ANIME4K.md.
val mpvVersion = "1.2.7"
val mpvArtifacts = mapOf(
    "arm64-v8a" to "13e882d96b8cd235425172b022e4a94dfcae5f07985dff85c8d648e7369fa2d1",
    "armeabi-v7a" to "7f522ed762ea6dfeba93a02e3837c5538790030b9965a03ed3a00276adc7b32c",
    "x86_64" to "aed0fffc99e5e554d48e1af90bc700133c25fbc02615bf1bf17db9299365c481",
    "x86" to "9269643264a1c9689116467f313d5e1b23ea56a68d338ab940c5e8fcf07061c6"
)
val mpvTriples = mapOf("arm64-v8a" to "aarch64", "armeabi-v7a" to "armv7a", "x86_64" to "x86_64", "x86" to "i686")
val mpvArchitectures = mapOf("arm64-v8a" to "arm64", "armeabi-v7a" to "arm", "x86_64" to "x86_64", "x86" to "x86")
val mpvAndroid = extensions.getByType<BaseAppModuleExtension>()
mpvAndroid.ndkVersion = "27.0.12077973"
val mpvOutputs = layout.buildDirectory.dir("generated/anime4k/jniLibs")
val mpvNotices = tasks.register<Sync>("syncAnime4kNotices") {
    into(layout.buildDirectory.dir("generated/anime4k/legal"))
    from(file("../../../../licenses")) { into("licenses") }
    from(file("../../../../THIRD_PARTY_NOTICES.md"))
}
mpvAndroid.sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/anime4k/legal"))
tasks.named("preBuild").configure { dependsOn(mpvNotices) }
mpvArtifacts.forEach { (abi, checksum) ->
    val architecture = mpvArchitectures.getValue(abi)
    val abiOutputs = mpvOutputs.map { it.dir(architecture) }
    mpvAndroid.sourceSets.getByName(architecture).jniLibs.srcDir(abiOutputs)
    mpvAndroid.sourceSets.getByName("universal").jniLibs.srcDir(abiOutputs)
    val task = tasks.register("prepareAnime4k${mpvArchitectures.getValue(abi).replaceFirstChar { it.uppercase() }}") {
        inputs.dir("src/main/cpp")
        inputs.property("mpvArtifact", "$mpvVersion/$abi/$checksum")
        outputs.dir(abiOutputs.map { it.dir(abi) })
        doLast {
            val archive = File(gradle.gradleUserHomeDir, "caches/genzo-mpv/$mpvVersion/default-$abi.jar")
            archive.parentFile.mkdirs()
            fun digest() = MessageDigest.getInstance("SHA-256").digest(archive.readBytes()).joinToString("") { "%02x".format(it) }
            if (!archive.exists() || digest() != checksum) {
                val connection = java.net.URI("https://github.com/Predidit/libmpv-android-video-build/releases/download/v$mpvVersion/default-$abi.jar").toURL().openConnection()
                connection.connectTimeout = 30_000; connection.readTimeout = 120_000
                connection.getInputStream().use { input -> archive.outputStream().use { input.copyTo(it) } }
            }
            check(digest() == checksum) { "libmpv artifact checksum mismatch: $abi" }
            val output = abiOutputs.get().dir(abi).asFile.apply { mkdirs() }
            var extracted = false
            ZipInputStream(archive.inputStream()).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (entry.name == "lib/$abi/libmpv.so") {
                        File(output, "libmpv.so").outputStream().use { zip.copyTo(it) }; extracted = true
                    }
                    entry = zip.nextEntry
                }
            }
            check(extracted) { "Missing libmpv: $abi" }
            val host = if (System.getProperty("os.name").startsWith("Windows")) "windows-x86_64" else if (System.getProperty("os.name").startsWith("Mac")) "darwin-x86_64" else "linux-x86_64"
            val suffix = if (host.startsWith("windows")) ".exe" else ""
            val ndk = File(mpvAndroid.sdkDirectory, "ndk/${mpvAndroid.ndkVersion}")
            val compiler = File(ndk, "toolchains/llvm/prebuilt/$host/bin/clang$suffix")
            providers.exec {
                commandLine(compiler.absolutePath, "--target=${mpvTriples.getValue(abi)}-linux-android26", "-shared", "-fPIC", "-Oz", "-Wall", "-Werror", "-Wno-unused-parameter", "-Wl,-z,max-page-size=16384", "-Wl,-soname,libgenzompv.so", file("src/main/cpp/mpv_bridge.c").absolutePath, "-L${output.absolutePath}", "-lmpv", "-o", File(output, "libgenzompv.so").absolutePath)
            }.result.get().assertNormalExitValue()
        }
    }
    tasks.matching { it.name in listOf("pre${mpvArchitectures.getValue(abi).replaceFirstChar { it.uppercase() }}DebugBuild", "pre${mpvArchitectures.getValue(abi).replaceFirstChar { it.uppercase() }}ReleaseBuild", "preUniversalDebugBuild", "preUniversalReleaseBuild") }.configureEach { dependsOn(task) }
}
