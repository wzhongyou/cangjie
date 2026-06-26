package com.cangjie.services

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.io.File

/**
 * Agent Bridge Service — 管理 cj 进程
 *
 * Agent Runtime 不跑在 JVM 里，而是 spawn cj 子进程。
 * 这样可以完全复用 CLI 的所有能力。
 */
@Service(Service.Level.PROJECT)
class AgentBridgeService(val project: Project) {
    var binary: String = findBinary()

    private fun findBinary(): String {
        // 1. 项目本地编译的 cj
        val localBin = File(project.basePath, "cj")
        if (localBin.canExecute()) return localBin.absolutePath

        // 2. PATH 中的 cj
        val pathDirs = System.getenv("PATH")?.split(File.pathSeparator) ?: emptyList()
        for (dir in pathDirs) {
            val f = File(dir, "cj")
            if (f.canExecute()) return f.absolutePath
        }

        // 3. 默认使用 Bun 运行 TypeScript 源码
        return "bun"
    }

    fun runCommand(args: List<String>, workDir: File? = null): Process {
        val cmd = mutableListOf(binary)
        cmd.addAll(args)

        return ProcessBuilder(cmd)
            .directory(workDir ?: File(project.basePath ?: "."))
            .redirectErrorStream(true)
            .start()
    }
}
