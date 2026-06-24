# Cangjie（仓颉）

> 仓颉造字，天雨粟，鬼夜哭。

代码智能体 —— CLI 原生，VSCode 插件同步开发中。

---

## 快速开始

### CLI（命令行）

```bash
# 1. 从源码编译二进制（需要 bun）
pnpm build
bun build cli/dist/main.js --compile --outfile cj

# 2. 安装到 PATH
sudo cp cj /usr/local/bin/

# 3. 环境变量（写入 ~/.zshrc，注意加 export）
export ANTHROPIC_API_KEY=sk-ant-...     # 或 ANTHROPIC_AUTH_TOKEN
export ANTHROPIC_BASE_URL=...           # 可选，兼容 API 需要

# 4. 使用
cj "在项目里搜登录相关逻辑"             # 单次执行
cj                                      # 交互式 REPL
cj --yes "重构这个函数"                 # 跳过权限确认
cj --list                               # 历史会话
cj --resume <id>                        # 恢复会话
```

交互模式内置命令：

```
/help    帮助        /exit    退出
/save    保存会话    /list    历史会话
/memory  查看记忆    Ctrl+C   中断
```

### 数据存储

```
~/.cangjie/              # 全局
  sessions/              # 对话自动保存
  config.json

.cangjie/memory/          # 项目级（Agent 自动读取）
  tech-stack.md           # 例如：项目技术栈说明
```

---

## VSCode 插件（开发中）

功能已实现，本地可跑，待发布市场：

```bash
pnpm install
# F5 → 新窗口 → Cmd+Shift+L 打开对话
```

- Chat 面板 + 流式输出
- Diff Review（逐文件 Accept/Reject）
- 权限确认弹窗
- Cmd+K 行内编辑

---

## 当前能力

| 能力 | CLI | 插件 |
|------|:---:|:----:|
| 自然语言对话 | ✅ | ✅ |
| 读文件 / 搜索代码 (grep) | ✅ | ✅ |
| 写文件 / Diff 编辑 | ✅ | ✅ |
| 执行 Shell 命令 | ✅ | ✅ |
| 流式输出 | ✅ | ✅ |
| 多轮对话记忆 | ✅ | — |
| 会话持久化 (`--resume`) | ✅ | — |
| 项目 Memory (`.cangjie/`) | ✅ | — |
| Diff Review 面板 | — | ✅ |
| 权限弹窗确认 | — | ✅ |
| Cmd+K 行内编辑 | — | ✅ |

工具：`read_file` `grep` `write_file` `edit_file` `bash`

---

## 项目结构

```
cangjie/
├── cli/          # @cangjie/cli   CLI 命令行
├── plugin/       # VSCode 插件
├── core/         # @cangjie/core  Agent 运行时
├── shared/       # @cangjie/shared 共享类型
├── docs/         # 设计文档
└── .cangjie/     # 项目 memory
```

---

## 开发

```bash
# 环境
Node.js >= 22  |  pnpm >= 9

# 构建 + 测试
pnpm install
pnpm build
pnpm test

# 编译 CLI 二进制（需要 bun）
bun build cli/dist/main.js --compile --outfile cj

# 代码检查
pnpm lint          # Biome
pnpm typecheck     # TypeScript
```

---

## 路线图

| 阶段 | 状态 |
|------|------|
| CLI 可用版 | ✅ v0.1 |
| 会话 / Memory 持久化 | ✅ v0.1 |
| Agent Loop + 5 工具 | ✅ v0.1 |
| VSCode 插件 | ✅ 本地可用，待发布 |
| 代码智能（LSP / 混合搜索） | 📋 |
| MCP / Plugin 体系 | 📋 |

---

[MIT](LICENSE) © 2026 Wang Zhongyou
