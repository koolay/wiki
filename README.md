# Wiki 知识库

面向 AI Agent 的 Git 知识库：用 Markdown 沉淀程序设计相关的主题文章，通过 MCP 只读检索，通过 Cursor Skills 完成写入与整理。

## 项目概述

- **内容形式**：主题文章（约 800–1500 字），聚焦原则、模式、权衡与可执行建议
- **存储**：`knowledge/` 下的 Markdown 为唯一事实来源
- **索引**：`scripts/build-index.ts` 扫描文章并生成 `index/manifest.json`
- **检索**：TypeScript MCP Server（stdio），提供关键词搜索与全文读取
- **写入**：ingest / reorganize 两个 Cursor Skill，MCP 不提供写接口

详细设计见 [Agent Knowledge Base 设计说明](docs/superpowers/specs/2026-06-28-agent-knowledge-base-design.md)。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 添加或编辑文章

在 `knowledge/` 下创建 Markdown 文件，例如：

```
knowledge/design-principles/separation-of-concerns.md
```

每篇文章需包含 YAML frontmatter（见 `schema/entry.schema.json`）和固定正文结构（背景、核心思想、实践要点、代码示例、权衡与反模式、参考）。已发布文章必须包含 `## 实践要点` 与 `## 权衡与反模式` 两个二级标题。

### 3. 构建索引

```bash
npm run build-index
```

成功后会输出类似 `Wrote N entries to index/manifest.json`。校验失败时会列出 frontmatter 或正文错误，修正后重新运行即可。

### 4. 运行测试

```bash
npm test
```

## MCP 配置

在 Cursor 中启用本仓库的 MCP 服务器。项目已提供示例配置 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "wiki-knowledge-base": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

将上述内容合并到 Cursor 的 MCP 设置（或使用项目内 `.cursor/mcp.json`），重启 Cursor 后即可使用以下工具：

| 工具 | 说明 |
|------|------|
| `search_entries` | 关键词搜索（默认不含草稿） |
| `get_entry` | 按路径读取完整文章 |
| `list_tree` | 浏览目录树 |
| `get_stats` | 统计信息与索引是否过期 |

启动前请先执行 `npm run build-index`，否则 MCP 会提示找不到 manifest。

本地验证 MCP 进程：

```bash
npm run mcp
```

## Cursor Skills

| Skill | 路径 | 用途 |
|-------|------|------|
| **ingest** | `.cursor/skills/ingest/SKILL.md` | 将 URL、笔记或对话内容整理为新文章并发布 |
| **reorganize** | `.cursor/skills/reorganize/SKILL.md` | 将 `status: draft` 草稿完善为已发布文章 |

使用 Skill 完成写入后，务必运行 `npm run build-index` 更新索引。

Agent 侧约定与 MCP 用法详见 [AGENTS.md](AGENTS.md)。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run build-index` | 扫描 `knowledge/` 并生成 `index/manifest.json` |
| `npm run mcp` | 启动 MCP 服务器（stdio） |
| `npm test` | 运行 Vitest 测试 |
| `npm run typecheck` | TypeScript 类型检查 |

## 目录结构

```
wiki/
├── knowledge/           # 知识文章（源数据）
├── index/
│   └── manifest.json    # 构建生成的元数据索引
├── schema/              # frontmatter JSON Schema
├── scripts/             # build-index 与搜索库
├── mcp-server/          # MCP 服务器
├── .cursor/
│   ├── mcp.json         # MCP 配置示例
│   └── skills/          # ingest / reorganize Skills
├── AGENTS.md            # Agent 使用指南
└── README.md            # 本文件
```

## 相关文档

- [设计说明](docs/superpowers/specs/2026-06-28-agent-knowledge-base-design.md)
- [实现计划](docs/superpowers/plans/2026-06-28-agent-knowledge-base.md)
- [Agent 指南](AGENTS.md)
