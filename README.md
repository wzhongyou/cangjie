# Cangjie（仓颉）

> 仓颉造字，天雨粟，鬼夜哭。

TypeScript 实现的 CLI 编码助手 —— Ink 终端 UI，本地运行，自主理解和修改代码。

---

## 快速开始

### 环境

- Node.js >= 22
- pnpm >= 9
- Bun >= 1.2（编译二进制用）

### 开发

```bash
pnpm install
pnpm build          # 编译 shared / core / cli
pnpm typecheck      # 类型检查
pnpm lint           # Biome 代码检查
pnpm test           # 运行测试
```

### 编译 CLI 二进制

```bash
# 两步编译：打包 → 编译（避免 React 重复打包）
bun build cli/dist/main.js --outfile cli/dist/bundle.js --target bun
bun build cli/dist/bundle.js --compile --outfile cj
sudo cp cj /usr/local/bin/
```

### 使用

```bash
# 配置 API key（按 provider 选择）
cp .env.example .env

# Anthropic（默认）
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-...

# DeepSeek 等（OpenAI 兼容）
export DEEPSEEK_API_KEY=sk-...
cj --provider openai-compat --base-url https://api.deepseek.com/v1

# 或写入 ~/.cangjie/config.json
# { "provider": "openai-compat", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-..." }
```

```bash
# 单次执行
cj "在项目里搜索登录相关逻辑"

# 交互模式
cj

# 跳过权限确认
cj --yes "重构 user.ts"

# 历史会话
cj --list
cj --resume <id>
```

> **交互模式**：`bun run cli/dist/main.js` 使用 Ink TUI。编译版 `./cj` 使用 readline REPL（React/Ink 在 Bun compile 下有兼容问题，自动降级）。

交互模式内置命令：

| 命令 | 说明 |
|------|------|
| `/help` | 帮助 |
| `/save` | 保存会话 |
| `/exit` | 退出 |
| `/memory` | 查看记忆 |
| `/list` | 历史会话 |
| `Ctrl+C` | 中断当前操作 |

---

## 项目结构

```
cangjie/
├── cli/           CLI 命令行（Ink TUI）
│   └── src/
│       ├── main.ts        入口
│       ├── commands/      内置命令（help/exit/save/list/memory/clear）
│       └── tui/           Ink 终端 UI
│           ├── app.tsx           主组件
│           ├── components/       ChatView / DiffView / InputBox / StatusBar
│           ├── hooks/            流式状态管理
│           └── themes/           配色
├── core/          Agent 运行时
│   └── src/
│       ├── agent-loop.ts  主循环（AsyncGenerator 流式）
│       ├── tools/          10 个内置工具
│       ├── llm/            多模型接入 + 容错（重试/降级/限流）
│       ├── context/        上下文管理 + 压缩
│       ├── permission/     权限管道
│       ├── memory/         四层记忆系统
│       └── session-store.ts SQLite 会话持久化
├── shared/        共享类型
└── docs/          设计文档
```

---

## 当前能力

| 能力 | |
|------|------|
| 自然语言对话 | 流式输出 |
| 代码读写 | read / write / edit / grep / glob |
| Shell 执行 | 命令注入检测 + 高危告警 |
| Web 搜索 | DuckDuckGo 搜索 + 网页抓取 |
| 子 Agent | explore / plan / verify / execute |
| 多模型 | Anthropic / OpenAI / DeepSeek 等 |
| 会话持久化 | SQLite + `--resume` |
| 项目记忆 | `.cangjie/memory/` 目录自动读取 |
| 权限控制 | 四级管道，不可绕过 |
| MCP 协议 | 工具扩展 |
| Skills / Hooks | 插件体系 |

---

[MIT](LICENSE) © 2026 Wang Zhongyou
