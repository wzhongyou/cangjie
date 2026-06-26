package com.cangjie

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.terminal.JBTerminalWidget
import com.intellij.terminal.TerminalOptionsProvider
import com.intellij.openapi.application.ApplicationManager
import org.jetbrains.plugins.terminal.AbstractTerminalRunner
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import java.awt.BorderLayout
import javax.swing.JPanel

/**
 * ToolWindow 工厂 —— 在底部面板开一个终端跑 cj
 */
class CangjieToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = JPanel(BorderLayout())
        val widget = createTerminalWidget(project, toolWindow)
        panel.add(widget.component, BorderLayout.CENTER)
        toolWindow.contentManager.addContent(
            toolWindow.contentManager.factory.createContent(panel, "Cangjie", false)
        )
    }

    private fun createTerminalWidget(project: Project, toolWindow: ToolWindow): ShellTerminalWidget {
        val runner = object : AbstractTerminalRunner<ShellTerminalWidget>(project) {
            override fun createTerminalWidget(project: Project): ShellTerminalWidget {
                return ShellTerminalWidget(project, this)
            }

            override fun createProcess(builder: ProcessBuilder): Process {
                builder.command(listOf("cj"))
                builder.directory(java.io.File(project.basePath ?: System.getProperty("user.dir")))
                return builder.start()
            }
        }
        return runner.createTerminalWidget(project)
    }
}

/**
 * 插件入口
 */
class CangjiePlugin {
    companion object {
        fun getInstance(): CangjiePlugin = ApplicationManager.getApplication().getService(CangjiePlugin::class.java)
    }
}
