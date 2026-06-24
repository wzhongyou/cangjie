# Contributing to Cangjie

欢迎贡献！本文档说明如何搭建开发环境和提交代码。

## 环境要求

- **Node.js** >= 22（参考 [.nvmrc](.nvmrc)）
- **pnpm** >= 9
- **ANTHROPIC_API_KEY**（用于运行 Agent）

## 快速开始

```bash
# 1. 克隆并安装
git clone https://github.com/wzhongyou/cangjie.git
cd cangjie
pnpm install

# 2. 构建
pnpm build

# 3. 测试
pnpm test

# 4. 运行 CLI
export ANTHROPIC_API_KEY=sk-ant-...
node cli/dist/main.js "hello"
```

## 项目结构

```
cangjie/
├── shared/            # 共享类型定义
├── core/              # Agent 核心运行时
├── cli/               # CLI 命令行工具
├── plugin/            # VSCode 插件
├── docs/              # 设计文档
└── .github/workflows/ # CI/CD
```

## 开发流程

1. **Fork** 本仓库，从 `main` 分支创建 feature 分支
2. 编写代码，确保通过以下检查：
   ```bash
   pnpm lint         # Biome 检查
   pnpm typecheck    # TypeScript 类型检查
   pnpm build        # 构建所有包
   pnpm test         # 运行测试
   ```
3. 提交 PR，描述清楚改动内容和原因

## VSCode 调试

1. 按 `F5` 启动扩展开发窗口
2. 新窗口中 `Cmd+Shift+P` → "打开 Cangjie 对话"

## Commit 约定

- `feat:` 新功能
- `fix:` Bug 修复
- `refactor:` 重构
- `docs:` 文档
- `chore:` 构建/工具链
