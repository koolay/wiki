---
title: "smolvm：用可移植 microVM 隔离运行 OCI 工作负载"
date: 2026-08-16
summary: "smolvm 用 libkrun 在 macOS、Linux 和 Windows 上启动独立 guest kernel 的轻量 VM，兼容 OCI 镜像并可打包为 .smolmachine；适合需要比容器更强隔离的本地、CI 或 Agent 执行环境。"
status: published
tags:
  - ai-agents
  - microvm
  - sandboxing
  - rust
  - containers
keywords:
  - smolvm
  - libkrun
  - OCI image
  - .smolmachine
  - guest kernel
  - egress filtering
applies_to:
  - "运行 Agent 生成的不可信代码"
  - "需要跨平台本地 microVM 的 CI 工作负载"
  - "把 OCI 应用打包成自包含运行产物"
source:
  - url: "https://github.com/smol-machines/smolvm"
    type: article
related:
  - "ai-agents/celln-tool-leasing-isolation.md"
  - "ai-agents/nono-kernel-agent-sandbox.md"
---

## 背景

容器复用宿主 kernel，启动和分发很方便，但运行不可信代码时，隔离边界仍包含共享内核与显式暴露的宿主资源。完整虚拟机隔离更强，却常常带来镜像、daemon、启动时间和跨平台运维成本。smolvm 把 OCI 工作流与每工作负载一个 microVM 结合起来，面向本地开发、CI 和 AI Agent 执行器提供轻量的 guest/host 边界。

## 核心思想

smolvm 的基本单位不是容器进程，而是拥有独立 guest kernel 的 VM。`machine run` 适合一次性执行：VM 随命令退出而清理；`machine create/start/exec/stop` 适合需要保留安装包和文件系统的开发环境。输入仍可使用 Docker/OCI 镜像、`docker save` 归档或 rootfs 目录，因此不必把镜像构建和 VM 运行绑定到 Docker daemon。`pack create` 还能把 rootfs、OCI 层和存储封装为 `.smolmachine`，在匹配的宿主架构上重新水合。

底层由 libkrun 提供 VMM：macOS 使用 Hypervisor.framework，Linux 使用 KVM，Windows 使用 Windows Hypervisor Platform。内存通过 virtio balloon 弹性回收，设计上以较低的空闲成本承载多个 VM；这是一种资源模型，不等于所有机器或工作负载都能达到固定的启动与吞吐指标。

## 实践要点

- 默认从最小权限开始：不传 `--net`，VM 没有出站网络；需要联网时用 `--allow-host` 或 `--allow-cidr` 限制 egress，并谨慎添加端口转发。
- 将 `machine run` 用于不需要持久化的测试、依赖安装和 Agent 生成代码；需要跨会话状态时再创建命名 VM，并明确清理生命周期。
- 优先复用 OCI 镜像和 Smolfile，把镜像、CPU、内存、网络白名单、挂载和初始化命令一起声明，避免把运行权限散落在脚本中。
- `--volume` 是把宿主目录授权给 guest；不挂载 SSH 密钥、云凭据或整个 home。Git 场景可考虑 `--ssh-agent`，但转发期间 guest 仍能请求签名。
- 通过 `pack create` 生成分发物时验证宿主 OS、CPU 架构、启动参数和依赖；`.smolmachine` 解决部署依赖，不会消除平台 hypervisor 要求。

## 代码示例

一次性运行不可信程序，并只允许访问 npm registry：

```bash
smolvm machine run \
  --image node:22-alpine \
  --allow-host registry.npmjs.org \
  --volume "$PWD:/workspace:ro" \
  -- node /workspace/check.js
```

可复用的 `Smolfile`：

```toml
image = "python:3.12-alpine"
cpus = 2
memory = 2048

[network]
allow_hosts = ["pypi.org", "files.pythonhosted.org"]

[dev]
volumes = ["./src:/app:ro"]
init = ["pip install -r /app/requirements.txt"]
```

## 权衡与反模式

microVM 带来独立 kernel 和更清晰的 guest/host 边界，但仍信任宿主用户、操作系统、hypervisor、libkrun 与 smolvm；它不是自动具备强多租户保证的控制平面。把敏感目录挂载进去、开启任意网络、转发 SSH agent 或把秘密注入环境，都会重新扩大 workload 的权限。`--secret-env` 与 `--secret-file` 只是启动时把宿主值解析后放入 guest 环境，guest root 可读取该环境，不能把它当作秘密永不离开宿主的机制。

此外，GPU/CUDA、Windows 的网络与快照能力、macOS 签名 entitlement 等存在平台差异；需要统一调度、审计、租户配额或远程多用户 API 时，应在 smolvm 之上补充控制面和宿主级隔离。不要因为“比容器更安全”就跳过镜像供应链、挂载审查、网络策略和资源耗尽防护。

## 参考

- [smolvm README](https://github.com/smol-machines/smolvm/blob/0d7da4a2192b693e0b5b09be59adda85c7db3017/README.md)
- [smolvm Agent Reference（平台、CLI、Smolfile 与安全细节）](https://github.com/smol-machines/smolvm/blob/0d7da4a2192b693e0b5b09be59adda85c7db3017/AGENTS.md)
- [smolvm releases](https://github.com/smol-machines/smolvm/releases)
