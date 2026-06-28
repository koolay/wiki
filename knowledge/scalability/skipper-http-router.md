---
title: "Skipper：可编程 HTTP 路由与反向代理"
date: 2026-06-28
summary: "Zalando 开源的 Go HTTP 路由器，用 eskip 声明路由、Filter 链与多数据源热更新，支撑超 30 万路由与 Kubernetes Ingress 生产规模。"
status: published
tags:
  - scalability
  - http-routing
  - reverse-proxy
  - kubernetes
  - go
keywords:
  - Skipper
  - eskip
  - predicates
  - filters
  - dataclient
  - ingress-controller
  - routesrv
applies_to:
  - "需要声明式 HTTP 路由与请求/响应改写的边缘或入口层"
  - "Kubernetes Ingress 控制器选型与大规模路由规则管理"
  - "以 Go 库扩展自定义 Filter/Predicate 的代理层"
source:
  - url: "https://github.com/zalando/skipper"
    type: article
  - url: "https://opensource.zalando.com/skipper/"
    type: article
related:
  - "scalability/client-side-load-balancing.md"
---

## 背景

微服务与 Kubernetes 普及后，入口层不再只是「把路径映射到 upstream」：需要按 Host、Method、Header、Cookie 等条件选路，在转发前改写请求、做鉴权、限流、熔断，并在规则变更时零停机热更新。Nginx/Envoy 配置强大但扩展模型各异；Zalando 自研 Skipper 作为 Go 库 + 可执行代理，面向**超大规模路由表**（生产曾达 35 万条 shop 前端路由）与 **Kubernetes Ingress**（100+ 集群、日流量 50 万–700 万 RPS）场景。

## 核心思想

Skipper 把每条路由拆成三部分：**Predicates**（是否匹配）、**Filters**（匹配后对请求/响应的链式处理）、**Backend**（目标 URL、负载均衡组或 shunt 本地终结）。路由定义语言 **eskip** 用 `->` 串联 Filter，用 `&&` 组合 Predicate，可读且可静态校验（`eskip check`）。

路由来源通过 **dataclient** 抽象：静态 eskip 文件、etcd、Kubernetes Ingress/RouteGroup、route string 或自定义源；多源合并后由 routing 层做匹配，**无需 reload 进程**即可更新规则。数据面同时流式转发请求与响应；控制面还可挂载 OAuth2/OIDC 鉴权 Filter、熔断、限流、OpenTelemetry 追踪等。配套 **routesrv** 用 ETag 缓存路由、减轻 kube-apiserver 压力；**webhook** 在部署前校验 Ingress 清单。

## 实践要点

- **本地起步**：`hello: Path("/hello") -> "https://www.example.org"` 写入 eskip，`skipper -routes-file` 启动，默认监听 `:9090`。
- **匹配优先级**：具体 Predicate（如 `Path`）优先于通配 `*`；复杂条件用自定义 Predicate 或 `Cookie()`、`Header()` 等内置谓词。
- **Filter 链顺序**：Filter 按声明顺序执行；常见模式：`setRequestHeader` / `setPath` / `setQuery` 改写后再 `-> backend`；`tee()` 做影子流量。
- **Kubernetes**：作为 Ingress Controller 无需 reload；大规模集群建议 routesrv 做路由分发面，Skipper 实例专注转发。
- **扩展方式**：官方推荐 **build your own proxy**（链接自定义 Filter/Predicate 包），而非 Go plugin（生态支持弱）；Lua Script 适合轻量逻辑。
- **运维**：暴露 metrics（`:9911`）、配置 load shedder 与 rate limit；小版本升级按 `v0.N → v0.N+1` 逐步读 release note（RBAC、Ingress API 变更等）。

## 代码示例

```eskip
# 按路径选路并改写 Host/Query
search:
    Path("/search")
    -> setRequestHeader("Host", "www.example.com")
    -> setPath("/api/v1/search")
    -> setQuery("q", "skipper")
    -> "https://backend.example.com";

# 默认路由 + Cookie 分流 + 影子流量
canary:
    * && Cookie("canary", "true")
    -> tee("http://127.0.0.1:9999/")
    -> "https://prod.example.com";
```

## 权衡与反模式

- **Skipper vs 通用 Ingress**：Skipper 强项是**海量细粒度路由 + 可编程 Filter 链**与 Go 可扩展性；简单静态反代或仅需 gRPC/HTTP2 高级特性的场景，Envoy/Istio 可能更合适。
- **Skipper vs Service Mesh**：Skipper 工作在 L7 入口/边缘，不替代 sidecar  mTLS 与服务间策略；可与 mesh 并存（边缘 Skipper + 网格内策略）。
- **共享 Skipper 做内部 fan-out**：高 QPS 且单请求 fan-out 到大量下游时，每条子请求都经共享 ingress 会放大延迟与故障面——内部路径应考虑客户端负载均衡（见 related），Skipper 保留在边缘。
- **路由爆炸**：35 万路由可行，但需 routesrv、合理 Predicate 设计与监控；把业务逻辑塞进 Filter 链会导致调试困难，复杂域逻辑应留在后端。
- **插件路径**：Go plugin 动态加载维护成本高；生产扩展优先静态链接自定义 binary。

## 参考

- [zalando/skipper](https://github.com/zalando/skipper) — 源码、release 与社区
- [Skipper 用户文档](https://opensource.zalando.com/skipper/) — eskip、Filter、Predicate、K8s Ingress
- [pkg.go.dev/github.com/zalando/skipper](https://pkg.go.dev/github.com/zalando/skipper) — 库 API 与扩展点
- [Building our own open source HTTP routing solution](https://jobs.zalando.com/tech/blog/building-our-own-open-source-http-routing-solution/) — Skipper 诞生背景
