---
title: "进程内客户端负载均衡：百万 RPS 内部 Fan-Out"
date: 2026-06-28
summary: "高 fan-out 内部流量应把路由决策移入调用进程，复用与边缘代理一致的哈希环，并用 occupancy 信号与渐进式 rollout 换取延迟、成本与可观测性。"
status: published
tags:
  - scalability
  - load-balancing
  - kubernetes
  - sre
keywords:
  - client-side load balancing
  - consistent hash
  - bounded load
  - occupancy
  - N-ring fade-in
  - Skipper
applies_to:
  - "单请求 fan-out 到数十/数百下游的高 QPS 内部调用"
  - "共享 ingress/代理成为延迟与故障归因盲区"
  - "依赖 pod 本地缓存的一致哈希路由迁移"
source:
  - url: "https://engineering.zalando.com/posts/2026/06/client-side-load-balancing.html"
    type: article
---

## 背景

Zalando Product Read API 每秒处理数百万请求，batch 端点会把一次请求拆成最多 100 个并行下游调用。若每个子请求都经过集群共享的 Skipper ingress，则一次 batch 对 Skipper 的暴露是单 GET 的 100 倍：延迟跟踪最慢的那条 hop，故障也难以区分是应用还是共享基础设施。边缘路由适合 Skipper；高 fan-out 的内部路径则应把路由决策移入调用进程（CSLB），而非替换整个代理。

## 核心思想

CSLB 不是抽象意义上的「自己写 LB」，而是**与 Skipper 哈希环完全一致**：xxHash64、每 endpoint 100 个虚拟节点、顺时针二分查找。迁移期两路并存时 hash parity 保证同一 product ID 落到同一 pod，避免缓存分裂与 DynamoDB 读放大。在此之上叠加 N-ring fade-in（扩缩容时新 ring 以 ^2.5 曲线渐进接管）、occupancy 驱动的 bounded load（而非 in-flight 或吞吐率），以及可选的 AZ 亲和路由（需与 bounded load 阈值联动，目前 Zalando 暂停生产试用）。

## 实践要点

- **发现**：用 Kubernetes EndpointSlice informer（list + watch），2 秒 debounce 合并扩缩事件；API 不可用时保留 last-good ring，永不呈现空环。
- **Rollout**：`CSLB_ENABLED` + `CSLB_PERCENTAGE` 渐进切流；失败或未命中 CSLB 的请求透明回落 Skipper，ConfigMap 一键回滚。
- **N-ring fade-in**：每次 scale 事件独立 fade 窗口（默认 30s）；pod 在所有 ring 上位置相同，预热流量与稳态一致。
- **Bounded load 信号**：`occupancy = total_occupied_time / window_duration`（150ms 五桶滑动窗口）；`effectiveLoad = max(inflight, occupancy) × min(podLatency/globalLatency, 5)`；walk 上限 10 hop，避免全网 stampede。
- **Zone 亲和**：本地流量按 ^2.5 曲线 ramp；latency health factor 在本地 P99 超全集群 35% 时压回 1% 探测；bounded load 阈值须按 local/global 双 ring 权重分别计算期望负载。
- **Fan-out 硬化**：单次快速重试（exclude 已试 URL）、FIFO 缓冲 + 出站 in-flight 硬顶、错误日志记录目标 pod IP 与 node——这是定位「节点级网络冻结」的关键。
- **先修流水线**：部署中位时间从约 289 分钟降到 128 分钟，才有条件做小步实验与回滚。

## 代码示例

```text
# occupancy（Little's Law 在窗口内的实现）
occupancy = sum(request_durations_in_window) / window_duration

# 有效负载（Finagle 思路：并发 × 相对延迟）
effectiveLoad = max(inflight, occupancy) * min(podLatency / globalLatency, 5)

# 双 ring 下的 bounded load 阈值（zone fade-in 期间）
loadPerLocalPod  = (totalLoad * localWeight) / localPodCount
loadPerGlobalPod = (totalLoad * (1 - localWeight)) / allPodCount
threshold = (loadPerLocalPod + loadPerGlobalPod) * balanceFactor
```

## 权衡与反模式

- **缓存局部性 vs 隔离**：一致哈希保局部性；AZ 亲和与 bounded load 重定向都会牺牲局部性——分区 pod 数不足以覆盖热 key 集时，省下来的跨 AZ 费用可能被 DynamoDB 读成本抵消。
- **错误信号**：in-flight 无法区分「千次 1ms 命中」与「少量 100ms miss」；吞吐率对 cache-hit  workload 严重高估负载，会导致 walk 打散 ring、命中率崩盘。
- **NIH 陷阱**：EndpointSlice watch + hash ring 看起来是周末工程，但长期拥有 stale ring、RBAC、watch 连接、性能热点与 on-call 面。仅在「单条内部路径百万 RPS 且共享 hop 放大暴露」时值得自建；须保留代理 fallback、只替换必要路径、生产 profiling。
- **部署慢即风险**：慢 pipeline 迫使大包发布，反过来让每次变更更难诊断——应先让 CI/CD 默认小步自动化，再叠 fade-in / zone 等实验。

## 参考

- [Client-Side Load Balancing at a Million Requests Per Second](https://engineering.zalando.com/posts/2026/06/client-side-load-balancing.html) — Conor Gallagher, Zalando Engineering, 2026-06-23
- [From Event-Driven Chaos to a Blazingly Fast Serving API](https://engineering.zalando.com/posts/2025/03/event-driven-to-api.html) — PRAPI 架构与 Skipper CHLB 背景
