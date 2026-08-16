---
title: "Celln：它和 Container、VM 有什么区别？"
date: 2026-08-11
summary: "用 Container、VM 和 Celln 的对比理解 Celln：它用 microVM 提供较强隔离，但不把完整机器或镜像交给 Agent，而是按任务临时借入经过验证的只读工具，并在任务结束后销毁。"
status: published
tags:
  - ai-agents
  - sandboxing
  - security
  - microvm
keywords:
  - Celln
  - tool leasing
  - agent lane
  - tool lane
  - mote
  - cell
  - authority ratchet
  - attestation
  - revocation
  - Landlock
  - seccomp
  - microVM
applies_to:
  - "需要运行 Agent 生成代码、但不希望把宿主机或完整容器环境交给 Agent 的执行平面"
  - "设计可验证、可撤销、最小权限的工具供应链与 Agent 沙箱"
  - "评估 microVM、内容哈希、解释器降权和受控网络出口的组合方案"
source:
  - url: "https://github.com/sympozium-ai/celln"
    type: article
  - url: "https://sympozium-ai.github.io/celln/model.html"
    type: article
  - url: "https://sympozium-ai.github.io/celln/security.html"
    type: article
  - url: "https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/crates/celln-manifest/src/lib.rs"
    type: article
  - url: "https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/crates/celln-pilot/src/guest.rs"
    type: article
  - url: "https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/crates/celln-warden/src/ratchet.rs"
    type: article
---

## 背景

运行 Agent 生成的代码时，最常见的选择是 Container 或 VM。Container 启动快、使用方便，但和宿主共享内核；VM 隔离更强，却通常要准备一套完整的 guest OS。Celln 想解决的是中间那个具体问题：**让 Agent 能运行代码，但只给它完成当前任务所需的能力**。

## 核心思想

先看结论：

| 方案 | 给 Agent 什么 | 隔离方式 | 主要特点 |
| --- | --- | --- | --- |
| Container | 一个镜像和文件系统 | 共享宿主内核 | 快、成熟，但容器里的进程仍依赖宿主内核 |
| VM | 一台虚拟机器，通常包含完整 guest OS | 独立 guest kernel | 隔离强，但启动和维护成本更高 |
| Celln | 一个短命 microVM + 临时借入的工具 | KVM 硬件隔离 | 不给完整机器；工具只读、按任务借入、可撤销 |

所以 Celln 不是“更快的 Container”，也不是“再包装一层 VM”。它把 VM 用作底层隔离，把“工具从哪里来、能否执行、何时失效”做成了任务级权限模型。官方的说法很直白：给 Agent 一份临时 lease，而不是一台机器。[Celln 模型说明](https://sympozium-ai.github.io/celln/model.html)

## 实践要点

- **Container 适合可信度较高的代码**：例如普通 CI、开发环境和服务部署。它的优势是快和生态丰富；代价是共享宿主内核，不能把它当成绝对安全边界。
- **VM 适合更强的隔离**：例如运行不可信程序。代价是要管理 guest OS、镜像和其中的工具。
- **Celln 把工具留在宿主**：宿主先验证工具内容，再把需要的工具以只读方式映射进 cell；Agent 不负责下载、安装或修改这套工具。[Celln README](https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/README.md)
- **Agent 写的代码不会自动继承工具权限**：即使 Agent 使用的是已验证的 Python，运行 Agent 写入的脚本时也会进入更受限的 agent lane，避免“用可信解释器洗白不可信代码”。
- **默认没有任意网络**：需要访问网络时必须明确声明允许的主机；Celln 通过宿主代理转发，而不是给 cell 一张随便可用的网卡。[安全边界](https://sympozium-ai.github.io/celln/security.html)
- **任务结束即销毁**：临时工作区不会自动变成下一次任务的环境；工具哈希也可以被撤销，正在运行的 cell 仍会受到撤销影响。

## 代码示例

```toml
name = "code-reviewer"

[cell]
memory = "256MiB"
require_tier = "verified"

[[tool]]
alias = "/usr/bin/python"
path = "/usr/bin/python3"
interpreter = true

[run]
exec = "/usr/bin/python"
args = ["review.py"]
input = "data"
```

这个配置表达的不是“安装 Python”，而是“允许这个任务借用宿主上的 Python”。先用 `celln spec check agent.toml` 检查，再用 `celln run agent.toml` 执行；如果 `review.py` 是 Agent 写入的，Python 仍按受限的 agent lane 运行。[CLI 示例](https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/README.md)

## 权衡与反模式

Celln 的隔离保证依赖 Linux、可读 kernel image 和 `/dev/kvm`；不具备这些条件时，项目不会宣称拥有硬件隔离。它也不替代对宿主、Agent CLI 和工具供应链的信任。[安全边界](https://sympozium-ai.github.io/celln/security.html)

最容易犯的错，是把 Celln 当成“带 microVM 的 Docker”，然后给它完整宿主目录、任意网络或可修改的工具。这样做会破坏它的核心价值。简单选择可以是：普通可信任务用 Container；需要完整隔离的任务用 VM；需要运行 Agent 生成代码，并且希望能力按任务发放、随时撤销时，再考虑 Celln。项目当前仍标注为 pre-alpha、single-host。[项目 README](https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/README.md)

## 参考

- [Celln repository README](https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/README.md) — 产品定位、CLI、执行 lane、网络和环境限制。
- [Celln model](https://sympozium-ai.github.io/celln/model.html) — mote、cell、assay、warden、pilot 与生命周期。
- [Celln security boundary](https://sympozium-ai.github.io/celln/security.html) — KVM、只读工具页、Agent 代码、网络及不作出的保证。
- [Celln README](https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/README.md) — CLI、工具借入、Agent 代码和网络限制。
- [Celln model](https://sympozium-ai.github.io/celln/model.html) — Celln 的执行模型。
- [Celln security boundary](https://sympozium-ai.github.io/celln/security.html) — 隔离保证和明确不作出的保证。
- [Manifest lane resolution](https://github.com/sympozium-ai/celln/blob/c4a2ec14816b3690eba6649cd2da193fe7826f24/crates/celln-manifest/src/lib.rs) — 工具认证、Agent lane 和撤销的实现依据；调查基于 commit `c4a2ec1`（2026-08-10）。
