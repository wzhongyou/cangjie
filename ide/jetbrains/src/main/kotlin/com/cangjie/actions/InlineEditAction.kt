package com.cangjie.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.VirtualFileManager
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Cmd+K 触发 —— 选中代码发给 cj 处理
 */
class InlineEditAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val project = e.project ?: return
        val selection = editor.selectionModel
        val selectedText = selection.selectedText ?: editor.document.text

        val instruction = Messages.showInputDialog(
            project, "告诉 Cangjie 你想怎么做？", "Cangjie: Edit Code",
            Messages.getQuestionIcon(), null,
            Messages.showInputDialog(project, "", "Cangjie", null, "优化这段代码") ?: "优化这段代码"
        ) ?: return

        val task = object : Task.Backgroundable(project, "Cangjie 正在处理...", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val cmd = listOf("cj", "-y", "$instruction\n\n\`\`\`\n$selectedText\n\`\`\`")
                    val pb = ProcessBuilder(cmd)
                        .directory(java.io.File(project.basePath ?: "."))
                        .redirectErrorStream(true)
                    val process = pb.start()

                    val reader = BufferedReader(InputStreamReader(process.inputStream))
                    val output = reader.readText()
                    process.waitFor()

                    // Refresh VFS to pick up file changes
                    ApplicationManager.getApplication().invokeLater {
                        VirtualFileManager.getInstance().refreshWithoutFileChanges(null)
                        Messages.showInfoMessage(project, output.takeLast(500), "Cangjie 完成")
                    }
                } catch (ex: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, ex.message, "Cangjie 错误")
                    }
                }
            }
        }
        ProgressManager.getInstance().run(task)
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        e.presentation.isEnabled = editor != null
    }
}
