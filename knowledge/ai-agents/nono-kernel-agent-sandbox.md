---
title: "nono：面向 AI Agent 的内核能力沙箱"
date: 2026-08-11
summary: "nono 是一个不依赖容器或 VM 的 AI Agent 沙箱：用 Linux Landlock、macOS Seatbelt 以及可选的监督式 seccomp-notify，把文件、网络、凭据和工具调用收敛为内核强制的最小能力。"
status: published
tags:
  - ai-agents
  - sandboxing
  - security
  - least-privilege
keywords:
  - nono
  - Landlock
  - Seatbelt
  - seccomp-notify
  - tool sandbox
  - capability-based security
  - credential proxy
  - WSL2
applies_to:
  - "需要在本机运行不可信 AI Agent 或其生成代码的开发工作流"
  - "希望把文件、网络、凭据和工具调用按能力拆分，而不是只套一层容器的执行平面"
  - "评估跨 macOS、Linux、WSL2 的轻量 Agent 沙箱方案"
source:
  - url: "https://github.com/nolabs-ai/nono/blob/main/README.md"
    type: article
  - url: "https://github.com/nolabs-ai/nono/blob/main/Cargo.toml"
    type: article
  - url: "https://github.com/nolabs-ai/nono/tree/main/crates/nono"
    type: article
  - url: "https://github.com/nolabs-ai/nono/tree/main/crates/nono-cli"
    type: article
  - url: "https://github.com/nolabs-ai/nono/tree/main/crates/nono-proxy"
    type: article
  - url: "https://nono.sh/docs/cli/internals/security-model"
    type: article
  - url: "https://nono.sh/docs/cli/internals/overview"
    type: article
  - url: "https://nono.sh/docs/cli/getting_started/installation"
    type: article
  - url: "https://github.com/nolabs-ai/nono/releases/tag/v0.70.0"
    type: article
---

## 背景

AI Agent 不只读写仓库，还会调用 `git`、`gh`、`curl`、`kubectl`、包管理器和 MCP 工具；风险往往来自这些工具携带的凭据、网络和副作用。[nono README](https://github.com/nolabs-ai/nono/blob/main/README.md) 将它定位为不依赖守护进程、容器或 VM 的低延迟 Agent 沙箱。

## 核心思想

nono 采用“默认拒绝、显式授予”的 capability-based 模型。CLI 根据文件、网络和 profile 生成策略；内核负责最终阻断，沙箱应用后不能由进程或 nono 撤销。Linux 以 Landlock 为底座，监督模式可叠加 seccomp-notify：父进程拦截 `openat`/`openat2`，自己打开文件并注入 fd，避免把获批路径交回不可信子进程。[安全模型](https://nono.sh/docs/cli/internals/security-model)

关键差异是工具也有边界：broker 为受控工具启动独立子沙箱，不继承会话的 CWD、宽泛授权、原始凭据或网络。`nono-proxy` 在监督进程中做主机过滤、DNS rebinding 防护和凭据注入，沙箱内只看到 phantom token。[工具沙箱](https://nono.sh/docs/cli/features/tool-sandbox)

## 实践要点

- workspace 拆分为核心库 `nono`、CLI `nono-cli`、代理 `nono-proxy` 和 C 绑定，并提供 Rust/Python/TypeScript/Go 绑定。[workspace](https://github.com/nolabs-ai/nono/blob/main/Cargo.toml)
- 常用流程是 `nono search` 查 profile、`nono pull` 安装 pack、`nono run --profile ... -- agent` 启动；`nono profile init ... --extends ...` 生成可审查的本地 JSON profile。
- `--read`/`--write` 分离权限，`--block-net` 禁止出网；`nono shell` 进入交互 shell，`nono why` 解释拒绝原因，`--dry-run` 只预览能力。[CLI README](https://github.com/nolabs-ai/nono/tree/main/crates/nono-cli)
- 网络默认并非完全关闭；构建、测试等离线任务应显式 `--block-net`，联网任务应使用 profile 的域名、端口和代理规则收窄范围。[架构概览](https://nono.sh/docs/cli/internals/overview)

## 代码示例

```bash
brew install nono
nono run --read ./src --write ./build --block-net -- cargo build
nono run --profile nolabs-ai/opencode -- opencode
nono run --allow-cwd --dry-run -- my-agent
```

源码集成时，能力一旦应用就是单向收紧：

```rust
use nono::{CapabilitySet, Sandbox};

let mut caps = CapabilitySet::new();
caps.allow_read("/data/models")?;
caps.allow_write("/tmp/workspace")?;
Sandbox::apply_auto(&caps)?;
```

[核心库 README](https://github.com/nolabs-ai/nono/tree/main/crates/nono) 展示了同一模型的 Rust API。

## 权衡与反模式

平台上，Linux 需要 5.13+ 内核的 Landlock；macOS 使用 Seatbelt；Windows 原生不支持，需在 WSL2 内安装，官方标注约 84% 功能覆盖。[安装矩阵](https://nono.sh/docs/cli/getting_started/installation) 安装可用 Homebrew、Deb/RPM、Nix、AUR 或源码；仓库 workspace 当前要求 Rust 1.95。[Cargo.toml](https://github.com/nolabs-ai/nono/blob/main/Cargo.toml)

nono 不是 guest/host 隔离：同一用户下的其他进程仍在边界外，强多租户场景应再套容器或 microVM。它不解决内核漏洞、隐蔽信道、获准目录内的数据破坏和资源耗尽；宽泛 `--allow`、原始密钥或任意网络会抵消最小权限。项目在 1.0 前仍提示 API 可能变化；截至研究时最新发布版为 v0.70.0。[安全边界](https://nono.sh/docs/cli/internals/overview) [release](https://github.com/nolabs-ai/nono/releases/tag/v0.70.0)

## 参考

- [nono README](https://github.com/nolabs-ai/nono/blob/main/README.md)：定位、快速开始、profile 与工具沙箱。
- [nono workspace](https://github.com/nolabs-ai/nono/blob/main/Cargo.toml)：Rust workspace、crate 成员和最低 Rust 版本。
- [nono-cli README](https://github.com/nolabs-ai/nono/tree/main/crates/nono-cli)：安装、主要命令和 profile 用法。
- [Security Model](https://nono.sh/docs/cli/internals/security-model)：信任边界、Landlock + seccomp-notify 和监督进程。
- [Architecture Overview](https://nono.sh/docs/cli/internals/overview)：安全保证、默认网络行为和不覆盖的威胁。
- [Installation](https://nono.sh/docs/cli/getting_started/installation)：Linux、macOS、WSL2 和原生 Windows 支持矩阵。
- [v0.70.0 release](https://github.com/nolabs-ai/nono/releases/tag/v0.70.0)：版本状态与近期 CLI、代理、工具沙箱变更。
