# Cangjie（仓颉）

> 仓颉造字，天雨粟，鬼夜哭。

代码智能体 —— 能自主搜索、理解、修改代码。

---

## 当前状态

VSCode 插件形态，早期开发阶段。还没上市场，需要本地跑。

---

## 开发环境

```bash
# 环境要求
Node.js >= 22
pnpm >= 9

# 装依赖
pnpm install

# 构建
pnpm tsc -b packages/shared packages/agent-runtime packages/vscode-extension
# 或者 VSCode 里 Cmd+Shift+B（配好了 build task）

# 调试
# F5 → 选 "Run Cangjie Extension" → 新窗口里 Cmd+Shift+P → Cangjie: Open Chat

# 设 API Key（否则 Agent 跑不起来）
export ANTHROPIC_API_KEY=sk-ant-...
# 或者在打开的调试窗口里 Cmd+, → 搜 cangjie.llm.apiKey
```

---

## 能干什么

打开 Chat 面板，用自然语言下指令。Agent 自己搜索代码、定位、改文件、验证。

```
"auth.ts 的 token 刷新逻辑有个 Bug，修一下"
"这个项目认证模块怎么设计的，讲清楚"
"给登录接口加个验证码校验"
"重构 user.ts，把这几个函数拆到单独文件"
```

实际效果取决于你配的模型。Agent 会自己调工具（读文件、搜索、编辑、跑命令）。

---

## 怎么工作的

```
你发指令 → Agent 规划步骤 → 搜代码 → 读文件 → 改代码 → 验证 → Diff Review
```

工具：`read_file` `grep` `write_file` `edit_file` `bash`

---

## 配置

```json
// VSCode settings.json
{
  "cangjie.llm.provider": "anthropic",
  "cangjie.llm.model": "claude-sonnet-4-6",
  "cangjie.autoAllowReadOnly": true
}
```

---

## 技术栈

纯 TypeScript。[设计文档](docs/cangjie-design.md)

| 层 | 选型 |
|----|------|
| 桌面 | VSCode Extension → 独立 App |
| Agent | TypeScript (Node.js 22+) |
| UI | React + Tailwind |
| LLM | Anthropic / OpenAI / Gemini |

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
