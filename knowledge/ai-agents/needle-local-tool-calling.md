---
title: "Needle：面向受限设备的本地工具调用模型"
date: 2026-08-25
summary: "Needle 用小型本地模型、受 JSON Schema 约束的调用输出和有限工具检索，为边缘设备提供工具调用与结构化提取；宿主程序仍须承担授权、语义校验和审计。"
status: published
tags:
  - ai-agents
  - tool-calling
  - edge-ai
  - structured-extraction
  - local-inference
keywords:
  - Needle
  - local tool calling
  - function calling
  - structured extraction
  - JSON Schema
  - edge inference
applies_to:
  - "内存、网络或功耗受限设备上的本地自动化"
  - "需要小模型输出受约束工具参数的 Agent 集成"
  - "从短文本中进行本地结构化字段提取"
source:
  - url: "https://github.com/cactus-compute/needle"
    type: article
  - url: "https://cactuscompute.com/needle"
    type: article
related:
  - "ai-agents/loop-engineering.md"
  - "ai-agents/nono-kernel-agent-sandbox.md"
  - "ai-agents/cactus-edge-ai-runtime.md"
---

## 背景

许多 Agent 的工具调用依赖云端大模型：应用把用户意图和工具描述发送到远端，再执行返回的函数调用。这个方式在复杂推理上很有优势，但在离线、低延迟、隐私敏感或内存很小的设备上不一定可行。Needle 2 是 `cactus-compute/needle` 提供的本地运行时与小型模型，专门将自然语言映射为工具调用 JSON，或将文本抽取为预先声明的结构。官方产品页将其定位为 45M 参数、单个 14MB binary、约 28MB 会话内存的方案；这些数值和基准属于项目方声明，采用前应在目标硬件、真实工具集和真实输入分布上复测。[Needle 产品页](https://cactuscompute.com/needle) [官方 README](https://github.com/cactus-compute/needle/blob/main/README.md)

Needle 的边界很重要：它并不执行“智能体的全部工作”，也不以开放式聊天或世界知识为目标。模型决定建议调用哪个已注册工具及参数；真正的函数执行、身份鉴别、权限、事务、超时、重试、审计与用户确认仍由宿主应用负责。官方将该取舍表述为：设备动作可被转化为“在固定、带类型参数的函数中选择并填参”，无需通用聊天所需的数十亿参数知识容量。把它看作一个受限的本地意图到 JSON 转换器，比把它误当作通用聊天模型或安全执行环境更准确。[Needle 产品页：Our Bet](https://cactuscompute.com/needle)

## 核心思想

Needle 的调用合约由工具 schema 驱动。应用可以通过 `@tool` 从 Python 函数签名和 docstring 推导 schema，也可以给出 Pydantic model、JSON Schema dict 或 JSON 字符串。模型输出带有 `type`、`function_calls`、`reasoning`、`confidence` 及性能统计的 JSON envelope；字节级 grammar 会使用已声明 schema 约束输出形状。字段的枚举、范围、正则、长度等约束可以进入 grammar，因此“参数不是合法 JSON”或“枚举值拼错”的风险较低；但 schema 不能判断“转账对象是否属于当前用户”“金额是否合理”或“资源是否仍存在”。业务语义与权限校验必须在模型输出之后、实际副作用之前再做一次。[API：声明工具与行为](https://github.com/cactus-compute/needle/blob/main/doc/apis.md#declaring-tools)

`complete()` 是单轮原语：应用接收调用建议、执行批准的函数，再把序列化结果喂回下一轮。`run()` 才是便利循环：它在本进程直接执行注册的 Python 函数，默认最多 8 步，并将函数异常作为字符串结果回传给模型。前者把控制权留给 orchestration 层，适用于任何有副作用、跨系统或需要人工确认的工具；后者只适合已被严格封装、低风险且有幂等保障的本地操作。[API：驱动循环](https://github.com/cactus-compute/needle/blob/main/doc/apis.md#driving-the-loop) [实现](https://github.com/cactus-compute/needle/blob/main/needle/__init__.py)

`extract(text, schema)` 将目标 schema 作为唯一工具做一次调用：有调用时返回 Pydantic 对象或 dict，拒绝调用时返回 `None`。这让抽取结果的结构稳定，但 `None`、缺失的可选字段和低置信度都应是明确的业务状态，而不是被自动填补或当作成功。

其资源优势来自模型与推理共同设计，而非简单把普通模型压到 2 bit：产品页称训练阶段已让权重、activation 和 KV cache 适配 Cactus Quants，部署时以 CQ2-bit 运行；engine 将模型、tokenizer 与 grammar compiler 封装在单个 C++ binary 中，并按 CPU 指令集选择 kernel。会话采用 256-token sliding window，system prompt 与工具声明作为固定 sinks 保留，因此 KV cache 不会随对话无限增长。这个固定预算换来的是长对话上下文有限；涉及长期事实、Kubernetes 文档教学或复杂故障诊断时，应选择通用模型与检索，而不是试图让 Needle 记住更多内容。[Needle 产品页：Architecture](https://cactuscompute.com/needle)

## 实践要点

1. 先把工具设计成窄接口。每个工具只描述一个可审核的动作，参数使用明确类型、枚举、长度与范围；不要向模型暴露“运行任意命令”“执行任意 SQL”之类的万能入口。`@tool` 的 docstring 是模型理解工具用途的重要上下文，写清前置条件、单位与不可做的事。
2. 对副作用操作优先调用 `complete()`，在宿主侧逐项执行：将候选工具与 allowlist 比对；验证 schema 以外的业务条件、资源归属和当前状态；为写操作设幂等键、超时和速率限制；记录模型建议、策略判定、实际请求与外部结果。不要因 grammar 已限制 JSON 就跳过这些步骤。
3. 工具不超过 5 个时，全部工具会进入上下文；超过 5 个时，Needle 会以 query 与工具 embedding 检索，只把得分最高的 5 个放入上下文并重建 grammar。未入选工具并非低概率，而是本轮完全不可调用。因此大工具目录必须以标注请求集测量“正确工具进入 top-5”的召回率，并为未召回设计分类、分组检索、重试或升级到更强模型的路径。[API：工具检索](https://github.com/cactus-compute/needle/blob/main/doc/apis.md#tool-retrieval)
4. 把长程业务状态放在应用里。README 描述其会话使用 256-token sliding window，工具可作为固定 KV sinks 以节约内存；这适合短命令与连续的设备交互，不保证长期对话条件始终可见。每轮应由应用重新传入当前用户、目标资源、授权范围和任务状态等事实。[官方 README](https://github.com/cactus-compute/needle/blob/main/README.md)
5. 将 `confidence` 作为路由信号而不是批准信号。项目建议业务方自行选择阈值，低分时复问或升级模型；应在真实数据上校准阈值，并按工具风险分层。使用 LoRA tuned `.cact` 权重时，源码会将 `confidence` 设为 `None`，因为校准 head 并未随微调更新；此时不能继承基础模型阈值。[API：置信度](https://github.com/cactus-compute/needle/blob/main/doc/apis.md#confidence)
6. 离线部署要显式预取和验收。wrapper 会依序从 `NEEDLE_LIB_PATH`、包目录和缓存目录查找 engine，缺失时才下载；将 engine 与 checkpoint 纳入镜像或设备制品，并在断网环境以 `HF_HUB_OFFLINE=1` 演练启动失败路径，避免把“首次下载成功”误当作离线能力。[API：离线设备](https://github.com/cactus-compute/needle/blob/main/doc/apis.md#offline-devices)
7. 用真实工具 trace 决定是否微调。基础模型的训练分布主要是消费设备、移动端、穿戴设备、电视与汽车动作，以及结构化抽取；官方明确说明通用/企业 API 表面不完全属于该分布。产品工具集固定且可收集正确调用 trace 时，才应使用 `needle finetune` 微调并重新评估“正确工具、参数、调用顺序、拒绝无关请求”；微调不是为 Kubernetes 或 Linux 增加百科知识的办法。[Needle 产品页：Evaluation 与 Fine-tuning](https://cactuscompute.com/needle)

### 现实场景：只按证据强度采用

以下不是“所有可想象的用途”。它们分别来自厂商点名的生产部署、官方浏览器 Sandbox 的预设，或官方代码/API 示例；后两类不应表述成已有客户案例。

| 证据级别 | 场景 | 官方可证实的范围 |
| --- | --- | --- |
| 已确认生产部署 | Pebble Index 01 app 的离线语音动作 | 产品页称 Pebble 在该应用本地运行 Needle，把语音请求转换为动作，并强调有网/无网均可工作；未公开工具清单、准确率和审批机制。 |
| 官方 Sandbox | 智能家居 | 两个并行工具调用；可用于将一句设备请求拆为两个已声明动作。 |
| 官方 Sandbox | 机器人 | 三步顺序调用；说明宿主可把前一步结果交回模型继续完成链式操作。 |
| 官方 Sandbox | Gallery、设备控制 | 两步图库链和三个浏览器设备操作，分别覆盖设备内容操作和 browser-mediated actions。 |
| 官方 Sandbox | 抽取后发邮件、文档字段抽取、情感分类 | 将文本转成结构化字段、枚举或后续工具参数，而不是开放式摘要。 |
| 官方 Sandbox | 汇率 API、航班表单 | 对宿主提供的 live API 或表单工具填充参数；不代表 Needle 自带实时数据、航班服务或联网能力。 |
| 官方 Sandbox | 12 工具路由、重复调用、数组参数、无关请求拒绝 | 覆盖候选工具检索、同一工具多次调用、批量参数与空调用拒绝。 |
| 官方 API/代码示例 | 灯光/温控控制 | `set_lights`、`set_thermostat` 等带类型和范围约束的设备命令；实际硬件集成由宿主实现。 |
| 官方 API/代码示例 | 发票、收据、引用元数据 | 从文字抽取金额、商家、作者、标题等类型化字段；不等于 OCR、验真、报销或文献管理系统。 |
| 官方 API/代码示例 | 设备状态驱动的相对时间 | 将日期、locale、电量、网络、位置等受信任 `system` facts 传入后，解析诸如“明天 7 点”的相对表达；模型不会自行读取这些状态。 |

这些场景的共同前提是：宿主先声明工具和 schema，Needle 再决定调用和参数，宿主最后执行。尤其在“实时汇率”“邮件”“航班”演示中，网络与外部系统能力属于工具实现，不属于 Needle；在气隙设备上，Needle 推理可离线，但外部服务是否可用另当别论。[Needle 2 Sandbox 与 Production](https://cactuscompute.com/needle) [官方 API 示例](https://github.com/cactus-compute/needle/blob/main/doc/apis.md)

截至本研究所查的官方资料，**没有** Kubernetes、Linux shell、`kubectl`、SSH、日志分析或服务器运维的生产案例、Sandbox 预设或官方教程。因此不能把上述设备控制案例外推成“Needle 已适用于运维”。若未来为运维定义少量只读工具，例如 `get_pod_status` 或 `get_recent_logs`，那是新的、待评测的 schema 集成；须在真实请求上评估工具 top-5 召回、参数正确性、拒绝率和权限网关，而非援引本表中的现实案例。

## 代码示例

下面的模式保留执行权：模型只能建议受限调用，策略层验证后才调用真实函数。示例中的授权和审计函数必须由应用实现。

```python
from needle import Needle, tool

@tool
def set_brightness(level: int) -> dict:
    """Set screen brightness. level must be 0 through 100."""
    # 这里才是设备 API；真实实现还应有超时与设备错误处理。
    return {"level": level, "changed": True}

agent = Needle(tools=[set_brightness])
reply = agent.complete("把屏幕亮度调到 35%")

for call in reply["function_calls"]:
    assert call["name"] == "set_brightness"          # 工具 allowlist
    level = call["arguments"]["level"]
    assert isinstance(level, int) and 0 <= level <= 100 # 业务再校验
    authorize_current_user("device.brightness.write")
    record_audit_event(call)
    result = set_brightness(level)
```

对于提取任务，schema 应表达数据形状，而下游仍应验证来源与语义：

```python
from pydantic import BaseModel, Field
from needle import extract

class Delivery(BaseModel):
    order_id: str = Field(pattern=r"^[A-Z0-9-]{6,32}$")
    quantity: int = Field(ge=1, le=999)

delivery = extract("订单 AB-1029，发货 3 件", Delivery)
if delivery is None:
    request_human_review()
else:
    validate_order_exists(delivery.order_id)  # schema 无法证明订单存在
```

## 权衡与反模式

Needle 用小模型和固定窗口换取本地性与低资源占用，因此不适合作为通用问答、长文推理或大量工具的无损路由器。项目文档规定：当请求无法匹配已声明工具时会以空调用 `[]` 拒绝，并没有自由文本回退；调用方应显式处理拒绝或提供另一个对话模型，而不是假设所有输入都会得到可执行动作。

不要直接把高权限函数交给 `run()`。其实现不提供事务、取消、跨调用审计、并发隔离或通用重试策略，工具异常还会作为模型下一轮的文本输入；错误消息不应包含凭据、内部拓扑或其他不应再次进入模型上下文的数据。也不要把 schema grammar 当作注入防护：恶意用户仍可能在合法字段中诱导越权意图，恶意工具结果也可能影响后续回合。

同一 Python 解释器中的 wrapper 使用模块级 active engine 与已加载权重。加载某个 tuned 权重后，再构建基础模型 agent 会被源码拒绝，`extract()` 默认也会复用当前权重；需要同时服务基础模型和多个微调版本时，应按进程或 worker 池隔离权重版本，并在服务入口明确路由。[共享引擎与权重实现](https://github.com/cactus-compute/needle/blob/main/needle/__init__.py)

## 参考

- [Needle 官方仓库与 README](https://github.com/cactus-compute/needle)
- [Needle 2 官方产品页](https://cactuscompute.com/needle)
- [Needle API 文档](https://github.com/cactus-compute/needle/blob/main/doc/apis.md)
- [Python wrapper 源码](https://github.com/cactus-compute/needle/blob/main/needle/__init__.py)
- [包元数据与依赖](https://github.com/cactus-compute/needle/blob/main/pyproject.toml)
