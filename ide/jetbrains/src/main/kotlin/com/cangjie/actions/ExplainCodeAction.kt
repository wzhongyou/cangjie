package com.cangjie.actions

import com.cangjie.CangjieToolWindowFactory
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.terminal.JBTerminalWidget
import org.jetbrains.plugins.terminal.ShellTerminalWidget

/**
 * 选中代码 → 打开 Cangjie ToolWindow → 粘贴解释请求到终端
 */
class ExplainCodeAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val project = e.project ?: return
        val selectedText = editor.selectionModel.selectedText ?: return

        // Open Cangjie tool window
        val tw = ToolWindowManager.getInstance(project).getToolWindow("Cangjie") ?: return
        tw.show()

        // Try to send the prompt to the terminal
        val content = tw.contentManager.getContent(0) ?: return
        val component = content.component
        if (component is javax.swing.JPanel) {
            // Find terminal widget in the panel
            val terminalWidget = findTerminalWidget(component)
            if (terminalWidget != null) {
                try {
                    val method = terminalWidget.javaClass.getMethod("executeCommand", String::class.java)
                    method.invoke(terminalWidget, "cj -y \"解释这段代码：\n\`\`\`\n$selectedText\n\`\`\`\"")
                } catch (_: Exception) {
                    // Fallback: user types manually
                }
            }
        }
    }

    private fun findTerminalWidget(component: java.awt.Container): ShellTerminalWidget? {
        for (child in component.components) {
            if (child is ShellTerminalWidget) return child
            if (child is java.awt.Container) {
                val found = findTerminalWidget(child)
                if (found != null) return found
            }
        }
        return null
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        e.presentation.isEnabled = editor != null && editor.selectionModel.hasSelection()
    }
}
