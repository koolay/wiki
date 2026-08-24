---
title: "Cactus：移动与可穿戴设备的混合边缘 AI 推理栈"
date: 2026-08-25
summary: "Cactus 将量化、设备优化 kernels、零拷贝计算图和多模态推理引擎组合为端侧运行时，并可按置信度将难题转交云端；采用时需独立验证模型、量化和设备组合。"
status: published
tags:
  - edge-ai
  - local-inference
  - model-quantization
  - ai-agents
  - mobile
keywords:
  - Cactus
  - on-device AI
  - hybrid edge-cloud
  - OpenAI-compatible API
  - quantization
  - Cactus Engine
applies_to:
  - "在 Apple 或 Android 设备上运行本地语言、语音或视觉模型"
  - "需要通过量化控制模型质量、内存与延迟权衡的边缘推理系统"
  - "将本地推理失败或低置信度请求受控地升级到云端的应用"
source:
  - url: "https://github.com/cactus-compute/cactus"
    type: article
related:
  - "ai-agents/needle-local-tool-calling.md"
  - "ai-agents/nono-kernel-agent-sandbox.md"
---

## 背景

在手机、可穿戴设备、智能家居和机器人上部署生成式 AI，瓶颈通常不是“能否调用模型”，而是模型权重、内存带宽、CPU/GPU/NPU 差异、首 token 延迟、电量、弱网与隐私边界。Cactus 是 `cactus-compute/cactus` 的开源端侧 AI 运行时项目，官方将其描述为面向移动设备与可穿戴设备的 hybrid edge-cloud engine。它把量化、设备 kernels、计算图和上层推理 API 放在同一工程中，覆盖文本生成、语音转写、视觉、embedding、RAG、向量索引、工具调用以及按置信度云端交接等能力。[官方 README](https://github.com/cactus-compute/cactus/blob/main/README.md)

它并不是一个“下载后任何模型都同样高效”的通用承诺。README 中的速度、内存与质量表以指定模型、量化格式、context 长度和设备为前提；例如 LLM 结果采用 Gemma-4-E2B-CQ4、1k context 的 prefill 与 100-token decode。应把这些结果视作项目方基准，按自己的模型、输入长度、热状态、后端与目标设备重新测量。[官方 benchmark 定义](https://github.com/cactus-compute/cactus/blob/main/README.md#inference-speed)

## 核心思想

Cactus 的架构从下至上分四层：Cactus Quants 是针对权重张量的 rotation-and-codebook 量化；Cactus Kernels 提供 CPU/GPU kernels；Cactus Graph 表达零拷贝计算图；Cactus Engine 提供推理与产品 API。上层 Engine 对外提供 C API，并经由 Swift、Kotlin、Flutter、React Native、Python 和 Rust 等 bindings 接入应用。这个分层的价值是让模型格式、算子执行和应用协议各自演化：应用使用聊天/流式/工具调用接口，运行时选择具体设备后端和量化权重，而不是把设备优化逻辑散落在业务代码中。[官方架构与 bindings](https://github.com/cactus-compute/cactus/blob/main/README.md)

Engine 的 completion 接口接收 JSON chat messages、生成选项、可选 tools JSON、流式回调和可选音频 buffer，返回 JSON。返回中除文本和解析出的 `function_calls` 外，还包含 `cloud_handoff`、`confidence`、首 token 时间、总耗时、prefill/decode tokens-per-second 和 RAM 使用量。因而 Cactus 的定位不是仅生成文本：调用者能够基于可观测的运行信号作预算、诊断和路由决策。[C Engine 示例](https://github.com/cactus-compute/cactus/blob/main/README.md#cactus-engine)

“hybrid”在这里是明确的失败/升级路径：本地模型的信心低于阈值时可 handoff 到云端；`cactus serve` 和 `cactus code` 都有 `--no-cloud-handoff`、`--confidence-threshold` 和 `--cloud-timeout-ms` 选项。是否允许该路径是产品和数据边界决策，而不是默认性能优化：一旦转云，提示词和相关上下文可能离开设备，且网络失败、成本和服务商策略都会成为可用性条件。[官方 CLI 说明](https://github.com/cactus-compute/cactus/blob/main/README.md#using-this-repo)

## 实践要点

1. 先选择部署形态。快速体验可在 macOS 用 Homebrew 安装后运行 `cactus run`；产品集成则在 C API 或所需 language binding 与应用之间设置一个小而稳定的适配层。需要服务形式时，`cactus serve [model]` 提供 OpenAI-compatible 的本地 HTTP server，默认绑定 `127.0.0.1:8080`；将监听地址改为公网/局域网地址前，必须另行配置认证、TLS、访问控制与资源配额。[官方快速开始与 serve 参数](https://github.com/cactus-compute/cactus/blob/main/README.md)
2. 明确模型制品的来源和生命周期。`cactus run` 可在缺少模型时下载或转换；`cactus download` 获取 bundle；`cactus convert <model>` 将 Hugging Face 模型转为 Cactus CQ weights，并能在转换时合并 LoRA。生产构建应锁定模型 revision、量化 bit width、转换器版本和 checksum，把下载/转换置于 CI 或制品阶段，而非让终端用户首次请求触发不可预测的网络和 CPU 开销。[官方 CLI：download 与 convert](https://github.com/cactus-compute/cactus/blob/main/README.md#using-this-repo)
3. 把量化选择当作验收实验。CLI 支持 `1|2|3|4|2.54|3.26` 等 CQ 位宽；更低 bit 往往节约内存与带宽，却可能显著损失推理、代码或多工具调用质量。官方质量表也显示同一 Gemma 基座在不同任务上随量化位宽有不同退化，不存在对所有任务都最优的数字。为目标任务建立准确率、安全拒绝率、工具调用正确率、峰值 RSS、首 token/p95 和耗电指标，再选满足底线的最低成本配置。[官方量化质量表](https://github.com/cactus-compute/cactus/blob/main/README.md#output-quality)
4. 将 cloud handoff 视为受控的路由器。先定义哪些请求允许离开设备；为本地低置信度、云端超时和云端失败分别设计可见的降级结果；记录每次 handoff 的原因、模型与阈值，但不要记录原始敏感 prompt。隐私优先应用应显式使用 `--no-cloud-handoff`，并以离线测试证明所有关键路径均可在本地完成。
5. 用项目的测试和 benchmark 命令验证目标，而非只跑演示。`cactus test` 可指定 kernels、graph、engine 或全部组件，也可选择模型、后端、量化位宽、iOS/Android 设备；`cactus benchmark` 支持相同类别的设备比较。将冷启动、模型加载、长上下文、连续并发、无网、低电量/热节流与工具调用纳入自己的验收矩阵。[官方 test 与 benchmark 参数](https://github.com/cactus-compute/cactus/blob/main/README.md#using-this-repo)

## 代码示例

下面是 README 所示 C Engine 调用的精简形态。缓冲区大小、返回码和 JSON 解析属于应用的安全边界；不要假设 `success` 为真就意味着生成内容可直接执行。

```c
#include "cactus_engine.h"

cactus_model_t model = cactus_init("weights/my-model", NULL, false);
const char* messages =
  "[{\"role\":\"user\",\"content\":\"Summarize this note\"}]";
const char* options = "{\"max_tokens\":128}";
char response[8192];

int rc = cactus_complete(
  model, messages, response, sizeof(response), options,
  NULL,       // tools JSON；需要工具调用时传入受审计的 schema
  NULL, NULL, // stream callback 与 userdata
  NULL, 0     // 可选 PCM buffer
);

if (rc != 0) {
  /* 记录受限错误信息，并走应用定义的重试/降级策略 */
}
/* 解析 response，检查 success/cloud_handoff/confidence；
   对 function_calls 仍执行应用侧授权与参数语义验证。 */
```

若需要本地服务接口，可在受限网络范围内运行：

```bash
cactus serve google/gemma-4-E2B-it \
  --host 127.0.0.1 --port 8080 \
  --bits 4 --no-cloud-handoff
```

这只是在回环地址启动兼容 OpenAI API 的服务，不会自动给它加入鉴权、审计、请求大小限制或多租户隔离。

## 权衡与反模式

不要以“端侧”推断绝对私密。`cactus auth` 管理 cloud API key，且 handoff 可将低置信度任务发送到云端；密钥存储、遥测、外发数据最小化与云端失败时的行为应在威胁建模中明确。README 还把 telemetry 标为默认关闭，启用前仍需审查所发送字段和用户同意。[官方 CLI：auth、handoff 与 telemetry](https://github.com/cactus-compute/cactus/blob/main/README.md#using-this-repo)

不要把 OpenAI-compatible 误解为完整的 OpenAI 托管服务等价物。它说明客户端协议可复用，但模型能力、参数覆盖范围、并发、鉴权、可观测性、工具执行责任和 SLA 都由本地部署与具体版本决定。应以小型兼容性测试固定所用 endpoint、streaming、tool schema 与错误格式。

最后，不要为追求最低内存盲目选择 1-bit 或 2-bit。量化、模型架构、设备 kernel、context 长度和任务难度会共同影响结果；转换任何 Hugging Face 模型的能力在 README 中也标为 experimental。先用受控的模型/量化组合建立质量门槛，再扩大模型覆盖面。对会造成副作用的工具调用，即使本地模型和 grammar 都正常，也必须保留宿主侧的权限、确认、幂等与审计链路。

## 参考

- [Cactus 官方仓库与 README](https://github.com/cactus-compute/cactus)
- [Cactus Engine 文档入口](https://github.com/cactus-compute/cactus/tree/main/cactus-engine)
- [Cactus Graph 文档入口](https://github.com/cactus-compute/cactus/tree/main/cactus-graph)
- [Cactus Kernels 文档入口](https://github.com/cactus-compute/cactus/tree/main/cactus-kernels)
- [Cactus Quants 文档](https://github.com/cactus-compute/cactus/blob/main/docs/cactus_quants.md)
