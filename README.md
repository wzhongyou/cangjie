# Cangjie（仓颉）

> 仓颉造字，天雨粟，鬼夜哭。

代码智能体 —— 能自主搜索、理解、修改代码。

先行插件，后起独立应用。

---

## 做什么

在 VSCode 里跟 Agent 对话，它自己搜索代码、定位问题、改文件、跑测试验证，你只管 Accept/Reject。

- 混合检索（BM25 + 向量 + AST 符号图）
- 自主 Agent Loop（规划 → 执行 → 验证）
- 本地索引，代码不上传
- 所有修改走 Diff Review

---

## 开始

```bash
# VSCode 里装插件
Cmd+Shift+P → Cangjie: Open Chat

# 以后也有 CLI
cj "把 auth.ts 的登录 Bug 修了，写测试验证"
```

---

## 技术栈

TypeScript 主力，性能卡点走 Rust napi-rs。

| 层 | 选型 |
|----|------|
| IDE | VSCode Extension + React + Tailwind |
| Agent Runtime | TypeScript (Node.js 22+) |
| 代码搜索 | Tantivy BM25 + LanceDB 向量 |
| 代码解析 | tree-sitter（Rust 桥接） |
| LLM | Anthropic / OpenAI / Gemini / 本地 |

---

## 路线图

| 阶段 | 交付 |
|------|------|
| Phase 1 | VSCode 插件 + Chat 面板 |
| Phase 2 | Agent Loop + 工具系统 + Diff Review |
| Phase 3 | 混合搜索 + 代码索引 |
| Phase 4 | Inline Edit + Memory 系统 |
| Phase 5 | MCP + Plugin |

---

[MIT](LICENSE) © 2026 Wang Zhongyou
