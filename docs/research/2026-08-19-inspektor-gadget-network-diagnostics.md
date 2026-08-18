# Inspektor Gadget Kubernetes 网络诊断研究

**主题：** Kubernetes 网络超时、DNS 请求链路、TCP RTT，以及 `gadgets/trace_tcp` 的实现与使用
**研究日期：** 2026-08-19
**资料截止：** 2026-08-19
**资料范围：** 仅使用 Inspektor Gadget 官方 use-case 页面、官方文档，以及 `inspektor-gadget/inspektor-gadget` 官方仓库 `main` 分支源码、清单和测试。本文不使用二手文章。

## 结论摘要

Inspektor Gadget 的网络诊断能力可以按“事件、报文、分布”三层理解：

1. **事件层：** `trace_tcp` 在内核 TCP 函数处观测 `connect`、`accept`、`close`，适合先回答“连接是否发起、是否被接受、是否失败、是否关闭”。它提供 Kubernetes workload 上下文，例如 node、namespace、pod、container，并可按 `--connect-only`、`--accept-only`、`--failure-only` 收窄事件。[`trace_tcp` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) [官方清单](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/gadget.yaml)
2. **报文层：** `tcpdump` 将指定 Kubernetes workload 的网络包导出为 `pcap-ng`，通过 TCP SYN/SYN-ACK/ACK、RST、重传、丢段和 ACK RTT 区分“没发出”“被拒绝”“握手成功后卡住”等同样表现为应用超时的问题。[官方 use case：诊断间歇性 Kubernetes 网络超时](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)
3. **分布层：** `profile_tcprtt` 从 Linux 内核已维护的 TCP socket 平滑 RTT 生成直方图；它观察的是已建立连接中的 RTT 操作，而不是 TCP 三次握手、DNS、TLS、服务端处理或完整请求延迟。连续监控时，每个 Gadget daemon pod 暴露 Prometheus-compatible `/metrics`，再按 worker node 聚合 p95。[`profile_tcprtt` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/) [官方 use case：跨 Kubernetes 节点监控 TCP RTT](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)

DNS 诊断的关键不是只看 CoreDNS 是否 Running，而是跟踪一个 DNS ID 穿过应用 Pod → `kube-dns` Service → CoreDNS → upstream resolver → 返回应用的路径；缺失的某一跳才是下一步排查边界。缓存命中可能没有 upstream 事件，因此“没有看到 upstream 查询”不能单独证明失败。[官方 use case：排查 Kubernetes DNS](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes) [官方 `trace_dns` 文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/)

## 一、如何把“网络超时”拆成可验证事件

应用日志里的 timeout 只说明调用方在期限内没有得到它需要的结果，不能直接说明是 DNS、连接建立、返回路径、服务端监听器、网络策略、MTU、CNI，还是应用协议处理慢。官方超时场景建议先捕获一次失败连接，然后按连接序列判断：

- 请求没有到达网络栈：优先检查应用连接池、名称解析或本地资源压力。
- 目的地址可达，但端口没有监听，或者中间设备主动拒绝：通常表现为立即 RST/拒绝，而不是长时间无响应。
- SYN、SYN-ACK、ACK 已完成，但后续数据停顿：网络路径已经建立，应转向服务端处理、连接上限、TLS 或应用协议。
- 数据包发出后重传：重点比较丢包、拥塞、MTU、跨节点 overlay/封装和中间防火墙。

这些判断来自官方 use case 的 packet-sequence 解释；它明确建议先看 TCP handshake 与 retransmission，而不是先读应用 payload。[官方超时诊断说明](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)

### 1.1 受控抓包命令

官方示例把捕获范围限定为生产 namespace 中的一个 backend Pod、PostgreSQL 端口和目标 IP，并设置 30 秒窗口：

```bash
kubectl gadget run tcpdump \
  --namespace production \
  --podname backend-service-7d9c8f \
  --pf "tcp port 5432 and host 10.20.30.40" \
  --timeout 30 \
  -o pcap-ng > db-timeout.pcapng
```

这里各参数承担不同职责：`--namespace` 和 `--podname` 将捕获绑定到 Kubernetes workload，`--pf` 使用 pcap-compatible 表达式缩小报文集合，`--timeout` 使一次诊断自动结束，`-o pcap-ng` 让结果能交给标准分析工具。若数据库有多个地址，或 5432 也被别的依赖使用，官方建议继续加入 `host` 等条件，避免把无关流量混进样本。[官方超时诊断示例](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)

离线检查可以使用：

```bash
tcpdump -nn -r db-timeout.pcapng
wireshark -r db-timeout.pcapng
```

在 Wireshark 中，官方列出的第一组过滤信号是：

```text
tcp.flags.syn == 1
tcp.flags.reset == 1
tcp.analysis.retransmission
tcp.analysis.lost_segment
tcp.analysis.ack_rtt
```

官方 use case 还说明，Inspektor Gadget 的 Wireshark dissector/extcap 能把 namespace、pod、container、node 上下文随报文带入分析，减少根据短生命周期 Pod IP 反查 workload 的工作；实时 extcap 抓包仍然需要让故障至少发生一次，且应保存包含失败的报文。[官方超时诊断说明](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)

### 1.2 用对照实验定位 Pod、节点还是 endpoint

对健康 backend replica 做等价请求，并比较：

| 对照结果 | 更应该检查的边界 |
| --- | --- |
| 同一节点一个 Pod 失败、另一个成功 | Pod-specific namespace、sidecar、NetworkPolicy、连接池或 endpoint 选择 |
| 所有受影响 Pod 都在一个节点 | 节点路由、CNI 状态、conntrack 压力、MTU、防火墙或物理网络路径 |
| 失败总是跟随某个数据库 IP | 该 endpoint 的健康、listener、连接上限或路由 |
| 只有跨节点流量失败 | CNI overlay、封装、MTU、路由或节点间防火墙 |

“对照 Pod”比只抓一份失败流量更重要：没有回复并不能指出具体是哪一个组件丢包，但比较健康路径与失败路径可以缩小故障点。[官方超时诊断说明](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)

### 1.3 这条方法能回答什么、不能回答什么

抓包适合判断包是否出现、顺序是否正确、是否重传、是否被 RST；它不能凭 TCP handshake 自动证明数据库查询执行时间、应用线程排队、TLS 上层处理或连接池等待。官方给出的终点判断包括：

- 所有 backend replica 对 `10.20.30.40:5432` 都立即 reset：优先检查 listener、服务端策略或中间拒绝者。
- 只有不同 MTU 节点之间出现数据重传：优先检查 overlay/封装后的有效 MTU 与跨节点路径。
- TCP 连接健康但应用仍有约 5 秒延迟：不要继续把时间花在网络握手，应检查数据库或应用协议。[官方超时诊断说明](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)

## 二、如何排查 Kubernetes DNS

### 2.1 先建立请求路径模型

官方 DNS 文档把典型的 `dnsPolicy=ClusterFirst` 路径拆成四类组件：

1. 应用 Pod 发起 DNS query。
2. query 发往 `kube-dns` Service。
3. Service 路由到 CoreDNS Pod。
4. 对外部名字，CoreDNS 可能创建新的 query ID 并向 upstream DNS 发起请求；响应再沿相反方向返回。

实际集群还可能有 NodeLocal DNS 等缓存/转发组件，所以输出会随 DNS/CNI 拓扑变化。该模型的价值是把“DNS 不通”转换为具体缺口：应用到 CoreDNS 不见了、CoreDNS 没有向 upstream 转发、upstream 没有响应，或 CoreDNS 收到响应但应用没有收到。[官方 `trace_dns` 文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/) [官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

### 2.2 最小可复现实验

官方 use case 用一个循环请求同时覆盖集群内服务、外部域名和确定不存在的名字：

```bash
kubectl create namespace dns-demo

kubectl -n dns-demo run dns-client \
  --image=busybox:1.36 \
  --restart=Never \
  --labels=app=dns-client \
  --command -- sh -c '
    while true; do
      nslookup kubernetes.default.svc.cluster.local >/dev/null 2>&1
      nslookup example.com >/dev/null 2>&1
      nslookup does-not-exist.inspektor-gadget.invalid >/dev/null 2>&1
      sleep 2
    done'

kubectl -n dns-demo wait --for=condition=Ready pod/dns-client --timeout=90s
```

只跟踪这个 Pod 的 A 记录请求，并保留关联和诊断所需字段：

```bash
kubectl gadget run trace_dns \
  -n dns-demo \
  -p dns-client \
  --timeout 10 \
  --filter "qtype==A" \
  --fields k8s.podName,id,qr,qtype,name,rcode,addresses,latency_ns
```

典型输出的字段含义如下：

| 字段 | 用途 |
| --- | --- |
| `k8s.podName` | 把事件归属到 Kubernetes Pod |
| `id` | 将同一 DNS query 的 `Q` 与 `R` 配对；端到端跟踪时还可观察 CoreDNS 发出的新 ID |
| `qr` | `Q` 表示 query，`R` 表示 response |
| `qtype` | 例如 `A` |
| `name` | 被查询的完整域名，示例包含末尾的 `.` |
| `rcode` | 例如 `Success`、`NameError`；判断“有响应但答案错误”很关键 |
| `addresses` | 返回的地址；可检查空答案或意外 endpoint |
| `latency_ns` | response 对应的 DNS 延迟，展示时可能被格式化成 `µs`/`ms` |

官方示例中，集群服务名返回 Kubernetes API Service 地址，`example.com` 返回外部地址，故意构造的无效域名返回 `NameError`；地址和延迟会随集群和运行变化。[官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

### 2.3 四种实际排查范围

#### 场景 A：先找全局失败响应

当受影响 namespace 尚未确定，或很多 workload 同时报告 DNS 错误时，先扩大到所有 namespace，再只取定位字段：

```bash
kubectl gadget run trace_dns \
  --all-namespaces \
  --timeout 120 \
  --fields k8s.node,src,dst,name,rcode,latency_ns
```

随后可用字段过滤失败响应，例如按 `rcode` 过滤；官方 use case 的核心做法是先保留 node、源/目的端点、名字、响应码和延迟，再回到具体 Pod。[官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

#### 场景 B：找慢响应

先收集 `latency_ns`，再按实际服务等级目标设阈值。不要把“有 response”误当作“DNS 健康”：慢的成功响应同样可能导致应用 timeout。官方 use case 将“慢 DNS response”作为独立场景，并要求按应用的 latency budget 选择阈值；由于本次严格范围内可直接核验的页面片段没有给出该场景的完整过滤器命令，本文不把自拟阈值或表达式冒充官方命令。已核验的官方采集命令见上面的最小复现实验（`--fields ... latency_ns`），再依据所选版本的字段过滤语法筛选。[官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

#### 场景 C：端到端跟踪一个名字

应用 Pod 和 CoreDNS Pod 同时纳入范围，按 DNS 名字筛选，并选择能表示路径的字段：

```bash
kubectl gadget run trace_dns \
  -n dns-demo,kube-system \
  -F 'k8s.podName~dns-client|coredns-.*' \
  -F 'name==example.com.' \
  --fields=k8s.node,k8s.namespace,k8s.podName,id,src,dst,qr,name,rcode,timestamp
```

解读步骤是：

- 应用 Pod → `kube-dns` Service：确认请求离开应用，并到达 Service 入口。
- 应用 Pod → CoreDNS Pod：确认 Service 路由和 CoreDNS 接收路径。
- CoreDNS → upstream：若出现新的 `id`，说明 CoreDNS 转发了请求。
- upstream → CoreDNS → 应用 Pod：检查响应是否逐跳返回。

官方特别提醒：CoreDNS cache 命中时可能没有 upstream query；NodeLocal DNS 也会增加缓存/转发阶段，因此缺少 upstream 事件必须结合已启用组件解释。输出也不是按 `timestamp` 排序，`timestamp` 适合辅助理解顺序，不能把终端排列顺序当作严格时间序列。[官方 `trace_dns` 文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/) [官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

#### 场景 D：只看 upstream resolver

当只有外部名字失败或很慢时，可按 upstream nameserver 地址收窄：

```bash
kubectl gadget run trace_dns \
  --all-namespaces \
  --timeout 120 \
  --fields src,dst,id,qr,name,nameserver,rcode,latency_ns \
  --filter 'nameserver.addr==192.0.2.53'
```

按 `id` 检查 query/response 配对：高 `latency_ns` 指向 resolver 慢；只有 query 没有 response 指向 upstream、路径或防火墙问题；有 response 但上游返回错误码则应看 resolver 数据或策略。[官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

### 2.4 DNS 的权限、作用域和局限

- `-n dns-demo`、`-p dns-client` 是精确定位；`--all-namespaces` 是全局搜索。官方文档还展示了 `-n demo,kube-system` 与多条件 `-F`，适合同时追应用 Pod 和 CoreDNS Pod。[官方 `trace_dns` 文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/)
- `trace_dns` 官方文档给出的最低尝试内核版本是 **5.4**；`trace_tcp` 与 `profile_tcprtt` 文档也给出 **5.4**。这不是“所有旧内核必然不可用”的数学断言，而是官方明确验证过的最低版本。[`trace_dns` 要求](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/) [`trace_tcp` 要求](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) [`profile_tcprtt` 要求](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/)
- DNS over TCP 只支持有限场景，因为 Gadget 不做 TCP stream reassembly；跨多个 TCP packet 的 DNS 请求无法完整跟踪。[官方 `trace_dns` 限制](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/)
- 这些命令需要有权通过 `kubectl gadget` 在节点上运行 Gadget；本地 `ig` 路径使用 `sudo ig run ...`。允许的官方资料没有给出一份可据此断言的固定 CAP 列表，因此不能把某组 Linux capability 当作本文结论；官方仓库的本地集成测试明确以 privileged 容器运行本地测试，说明本地验证需要相应的特权运行环境。[运行示例](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) [官方集成测试](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go)

## 三、如何监控 TCP RTT

### 3.1 RTT 的精确定义

`profile_tcprtt` 读取 Linux 内核已经为 TCP socket 维护的 **smoothed RTT**，按延迟区间生成 histogram。官方文档明确指出：

- 只统计已经 established 的 TCP connections。
- 不包含三次握手阶段；要测连接建立延迟，应使用连接跟踪类 Gadget 的 latency 能力，而不是 `profile_tcprtt`。
- `count` 是落入区间的 TCP RTT operation 数量。
- 区间边界是 `interval-start` → `interval-end`，单位是微秒。[官方 `profile_tcprtt` 文档](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/)

因此，RTT 直方图是网络路径延迟的一个组成部分，不是请求延迟、应用处理延迟或用户可感知端到端 latency 的替代品。[官方 TCP RTT use case](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)

### 3.2 交互式节点快照

在 Kubernetes 上，官方示例按节点启动：

```bash
kubectl gadget run profile_tcprtt:latest --node minikube-docker
```

输出为指数增长区间，例如 `4 -> 8`, `8 -> 16`, `16 -> 32` µs，并为每个区间显示 `count` 和 ASCII distribution。用一个 Nginx Service 和持续 `curl nginx` 产生流量后重新采样，即可观察流量增加后的分布变化。[官方 `profile_tcprtt` 文档](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/)

这种模式适合故障现场快速回答“该节点上目前的连接 RTT 分布是否异常”，但它不是长期指标：命令停止后没有时间序列保留，也不天然提供跨节点的 p95/p99 比较。

### 3.3 连续 Prometheus 指标

官方 use case 的连续配置有三个关键点：

```yaml
config:
  operator:
    otel-metrics:
      otel-metrics-listen: true
      otel-metrics-listen-address: "0.0.0.0:2224"

gadgetConfigMaps:
  - name: tcp-rtt-metrics
    imageName: ghcr.io/inspektor-gadget/gadget/profile_tcprtt:latest
    timeout: 0
    paramValues:
      operator.oci.annotate: "tcprtt:metrics.collect=true"
      operator.otel-metrics.otel-metrics-name: "tcprtt:tcp-rtt"
```

这里的语义是：

- `otel-metrics-listen` 在每个 Gadget pod 暴露 Prometheus-compatible `/metrics`。
- `gadgetConfigMaps` 创建持久的 `profile_tcprtt` 实例。
- `tcprtt:metrics.collect=true` 开启该 datasource 的指标采集。
- `tcp-rtt` 是唯一的 OpenTelemetry instrumentation scope，可作为 Prometheus 过滤标签。
- `timeout: 0` 表示持续监控，不把它当作一次性 trace。[官方 TCP RTT use case](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)

### 3.4 PodMonitor 与按节点聚合

官方示例的 PodMonitor 从 `gadget` namespace 选择 `k8s-app=gadget`，将目标端口改写为 `2224`，抓取 `/metrics`，并把 Pod 所在 Kubernetes worker node 重标记为 `instance`。它还删除 `pod`、`container`、`namespace` 等冗余标签，防止每个 daemon pod 的身份把本应按节点比较的 histogram 切得过细。[官方 TCP RTT use case](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)

示意配置：

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: gadget-tcp-rtt
  namespace: monitoring
spec:
  namespaceSelector:
    matchNames: [gadget]
  selector:
    matchLabels:
      k8s-app: gadget
  podMetricsEndpoints:
    - path: /metrics
      relabelings:
        - sourceLabels: [__address__]
          action: replace
          regex: '([^:]+)(?::\d+)?'
          replacement: '$1:2224'
          targetLabel: __address__
        - sourceLabels: [__meta_kubernetes_pod_node_name]
          targetLabel: instance
      metricRelabelings:
        - action: labeldrop
          regex: '(pod|container|namespace)'
```

在官方 use case 的命名约定下，按 node 计算 5 分钟 p95：

```promql
histogram_quantile(
  0.95,
  sum by (instance, le) (
    rate(latency_s_bucket{otel_scope_name="tcp-rtt"}[5m])
  )
) / 1000
```

原因是 histogram bucket 是累计 counter，必须先 `rate()`；`sum by (instance, le)` 保留 node 和 bucket 边界，再由 `histogram_quantile` 求分位数。官方说明：若所选版本的 bucket 单位是微秒，除以 1000 可转换为毫秒；实际部署前应核对暴露指标的单位，而不是盲目复制换算。[官方 TCP RTT use case](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)

### 3.5 RTT 结果的解释矩阵

| 观测 | 下一步 |
| --- | --- |
| 应用延迟升高，但 TCP RTT 稳定 | 看应用处理、依赖容量、连接池、TLS 或请求排队 |
| 所有节点 RTT 都升高 | 看共享网络、上游、拥塞或基础设施事件 |
| 只有一个节点 RTT 升高 | 看该节点路径、CNI、MTU、NIC、路由和 firewall |
| workload 迁移后 RTT 才升高 | 对比迁移前后节点的路径和 placement 约束 |
| histogram 长尾变长但中位数稳定 | 看间歇性丢包、重传、拥塞或少数 destination |

官方 use case 还建议关注“是否只在某个 worker node 出现”“部署或基础设施事件后分布是否变化”。这些是按 node 聚合而不删除 node identity 的直接理由。[官方 TCP RTT use case](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)

## 四、`gadgets/trace_tcp` 的实现与事件契约

### 4.1 用户可见行为

官方清单将 Gadget 定义为“monitor connect, accept and close events of TCP connections”，并声明三个布尔参数：

| CLI 参数 | 作用 | 默认值 |
| --- | --- | --- |
| `--accept-only` | 只显示 accept 事件 | `false` |
| `--connect-only` | 只显示 connect 事件 | `false` |
| `--failure-only` | 不显示成功事件 | `false` |

运行入口是：

```bash
kubectl gadget run ghcr.io/inspektor-gadget/gadget/trace_tcp:latest [flags]
sudo ig run ghcr.io/inspektor-gadget/gadget/trace_tcp:latest [flags]
```

默认 Kubernetes 表格包含 `K8S.NODE`、`K8S.NAMESPACE`、`K8S.PODNAME`、`K8S.CONTAINERNAME`、`SRC`、`DST`、`COMM`、`PID`、`TID`、`UID`、`GID`、`TYPE`。最小示例会等待连接；使用 `-A` 可以监控所有 namespace，避免只在默认 namespace 监听而漏掉事件。[官方 `trace_tcp` 文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) [`gadget.yaml`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/gadget.yaml)

JSON 输出可通过通用 `-o json` 获得，官方 run reference 展示的事件还包括：

```json
{
  "comm": "wget",
  "dst": {"addr": "1.1.1.1", "port": 80, "proto": 6, "version": 4},
  "k8s": {"namespace": "default", "node": "minikube", "podName": "mypod2"},
  "pid": 446916,
  "src": {"addr": "10.244.0.8", "port": 41464, "proto": 6, "version": 4},
  "tid": 446916,
  "timestamp": "2024-07-31T18:38:31.977700392Z",
  "type": "connect",
  "type_raw": 0,
  "uid": 0
}
```

完整事件 schema 还在官方集成测试中以 Go 结构体验证：`Timestamp`、`Proc`、`NetNsID`、`Src`、`Dst`、`Type`、`Error`、`Fd`、`AcceptFd`。测试检查 `connect`、`accept` 和 `close` 的 endpoint/进程字段，并把成功 `close` 的 `Error` 设为空、`Fd` 与 `AcceptFd` 设为 `-1`。这说明 CLI 默认列不是完整 schema；需要诊断失败原因或编程消费时，应选择 JSON/结构化字段。[官方 `trace_tcp` 集成测试](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go) [官方 run output 文档](https://inspektor-gadget.io/docs/latest/reference/run/)

### 4.2 内核 hook 与同步/异步 connect 路径

`program.bpf.c` 直接声明以下主要程序入口：

- `kprobe/tcp_v4_connect`
- `kretprobe/tcp_v4_connect`
- `kprobe/tcp_v6_connect`
- `kretprobe/tcp_v6_connect`
- `kprobe/tcp_close`
- `kprobe/tcp_set_state`
- `kretprobe/inet_csk_accept`

这些 section 也能通过官方镜像 inspect 的 `ebpf.sections` 元数据看到。[官方 `program.bpf.c`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/program.bpf.c) [官方镜像 inspect 文档](https://inspektor-gadget.io/docs/latest/reference/images/)

connect 的数据流是：

1. `tcp_v4_connect`/`tcp_v6_connect` 的 kprobe 先保存 socket 和网络信息，因为在对应 kretprobe 中需要恢复这些上下文。
2. kretprobe 补上系统调用返回结果/错误信息，并把按线程关联的上下文写入 `tuplepid` 等 map。
3. **同步 connect**：`tcp_set_state` 在 `sys_connect` 返回前完成，读取错误码并发出事件。
4. **异步 connect**：`sys_connect` 返回后，后续 `tcp_set_state` 路径完成状态转换，再读取 error code、发送事件。

官方 `README.mdx` 的 Mermaid 图明确画出 `sys_connect`、`tcp_v4_connect/tcp_v6_connect`、`tcp_set_state`、`tcp_connect_ctx`、`tuplepid`、`events` 之间的关系，并特别区分同步与异步路径；官方文档的 architecture 章节也说明异步调用的路径。[官方 `README.mdx` 架构图](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/README.mdx) [官方 `trace_tcp` 文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/)

### 4.3 accept 与 close

- `accept` 使用 `kretprobe/inet_csk_accept`，返回新的 socket 后调用 `handle_tcp_accept(ctx, sk)`，因此可关联已接受连接的源/目的端点和返回的 accept fd。[官方 `program.bpf.c`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/program.bpf.c) [官方 `accept.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/accept.h)
- `close` 使用 `kprobe/tcp_close`，调用 `handle_tcp_close` 读取 tuple 并生成 close 事件；集成测试验证 close 事件仍保留 `Src`、`Dst`、进程信息和 `Type=close`。[官方 `close.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/close.h) [官方集成测试](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go)

### 4.4 map、事件传输与上下文

官方镜像 inspect 示例列出 `trace_tcp` 的 eBPF maps：`gadget_heap`、`gadget_mntns_filter_map`、`tuplepid`、`sockets` 和 `events`；其中 `events` 是 `RingBuf`。这对应实现的三个责任：临时对象/过滤、按线程或 tuple 关联 socket 状态、再通过 ring buffer 将事件送到用户空间。[官方镜像 inspect 示例](https://inspektor-gadget.io/docs/main/reference/images/) [官方 `common.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/common.h)

`common.h` 包含 Linux `vmlinux.h`、BPF helpers、CO-RE/tracing headers，以及 Gadget 的 `buffer`、`common`、`filter`、`macros` 依赖；因此该 Gadget 不是从用户空间轮询 `/proc/net/tcp` 得到结果，而是由 eBPF hook 采集后通过 Gadget 数据源/过滤/上下文机制输出。[官方 `common.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/common.h)

### 4.5 过滤与 Kubernetes 作用域

过滤分为两种：

1. **Gadget 自身参数过滤：** `accept-only`、`connect-only`、`failure-only` 由清单声明，控制事件类型/成功状态。
2. **运行器的 Kubernetes/字段过滤：** `-n`、`-A`、`-p`、`--node`、`--containername` 和通用 `--fields`/`-F`/`--filter` 让用户在 namespace、Pod、node、container 或具体字段上缩小范围。`trace_dns` 官方示例展示了 `-n`、`-p`、`-A`、字段选择与表达式过滤；`trace_tcp` 文档展示了 `-A` 和 `--containername`。[官方 `trace_tcp` 文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) [官方 `trace_dns` 文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/) [官方运行参考](https://inspektor-gadget.io/docs/latest/reference/run/)

这意味着 Kubernetes 上同一个 eBPF Gadget 可以先在单 Pod 复现，再扩到 namespace 或所有 namespace；`-A` 能避免默认 namespace 的观察盲区，但也会增加事件量和解释复杂度，应配合 `--fields`、timeout 和 filters 使用。

## 五、权限、内核和边界条件清单

### 5.1 能力与权限

- 官方命令区分 Kubernetes 入口 `kubectl gadget run ...` 和本地入口 `sudo ig run ...`；这表明运行者至少要能让 Gadget 在目标节点加载/运行，并在 Kubernetes 模式下具备相应的 Gadget/daemon 运行权限。[官方 `trace_tcp` 文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/)
- 官方 `trace_tcp` 集成测试在本地 `ig` 分支为容器追加 `containers.WithPrivileged()`；不能把无特权的普通容器测试结果当作本地 BPF 运行权限的证明。[官方集成测试](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go)
- 允许的资料没有给出一份稳定、版本无关的 CAP 列表；因此部署 RBAC、Pod Security、容器特权和 BPF 相关内核配置时，应以所选 Inspektor Gadget 版本的安装/部署清单和目标内核实际错误为准，不能仅凭本文臆测 capability 名称。

### 5.2 内核和探针限制

- `trace_tcp`、`trace_dns`、`profile_tcprtt` 文档都把 **5.4** 标为最低尝试内核版本；旧内核是否工作仍取决于具体 hook、BTF/内核实现和 Gadget 版本。[官方 trace_tcp](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) [官方 trace_dns](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/) [官方 profile_tcprtt](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/)
- `trace_tcp` 依赖 `tcp_v4_connect`、`tcp_v6_connect`、`tcp_close`、`tcp_set_state`、`inet_csk_accept` 等 kernel symbol/hook；内核符号、BPF verifier、运行时 ABI 或容器隔离条件不满足时，不能把“命令启动”误解成“所有事件都已覆盖”。[官方 `program.bpf.c`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/program.bpf.c)
- `trace_dns` 对 DNS over TCP 不做 stream reassembly；多 packet DNS 请求不会被完整解析。[官方 `trace_dns` 限制](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/)

### 5.3 观测语义限制

- `trace_tcp` 的 `connect` 事件是 TCP 连接生命周期/错误视角，不等于应用请求完成；握手成功后应用仍可能在 TLS、数据库协议或服务端排队中超时。
- `profile_tcprtt` 只读 established socket 的 smoothed RTT，不覆盖 DNS、SYN handshake、TLS、服务端处理和完整请求延迟。[官方 TCP RTT use case](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)
- `trace_dns` 的终端输出不是天然按 timestamp 排序；CoreDNS cache 命中时也可能没有 upstream query。必须用 `id`、`qr`、`src`、`dst`、`timestamp` 和实际 DNS 拓扑重建路径。[官方 `trace_dns` 文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/)
- 捕获包时要限定 Pod、namespace、端口、目标 IP 和时间窗口；无边界的全量抓包会增加噪声、文件大小和敏感 payload 暴露面。官方示例的重点是先抓到一个失败序列，再选择最小的下一步检查。[官方超时诊断 use case](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)

## 六、推荐的现场操作顺序

1. **先定范围：** 记录失败 namespace、Pod、node、目标 DNS 名称/IP、目标端口和一个健康对照 Pod。
2. **先看 DNS：** 对失败名字用 `trace_dns` 保留 `id,qr,name,rcode,addresses,latency_ns,src,dst`；确认是无响应、错误码、慢响应还是地址错误。
3. **再看连接事件：** 用 `trace_tcp --connect-only` 或 `--failure-only` 确认连接是否发出、是否失败；按 namespace/Pod/node 缩小，避免全局事件噪声。[官方 `trace_tcp` 文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/)
4. **最后抓包：** 对明确的 Pod、端口和 endpoint 使用 `tcpdump` + `pcap-ng`，用 SYN/RST/retransmission/lost-segment/ACK RTT 判断网络路径。
5. **需要长期趋势时才开 RTT 指标：** 为 `profile_tcprtt` 配置 metrics collection，按 node 保留 `instance`，再查询 p95；不要用它替代应用 latency。
6. **按对照结果行动：** Pod-specific、node-specific、endpoint-specific、cross-node 和“TCP 健康但应用慢”分别进入不同的 owning team/检查边界。

这个顺序的核心是先用低成本、结构化事件缩小故障，再用有边界的报文样本确认路径，最后用按节点聚合的 RTT 时间序列验证是否存在持续性基础设施回归。它不会改变应用、重启 workload 或开启全局 verbose DNS logging，符合官方 DNS use case 对低扰动排查的目标。[官方 DNS use case](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)

## 官方资料索引

- [Diagnose intermittent Kubernetes network timeouts](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts)
- [Troubleshoot DNS in a Kubernetes cluster](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes)
- [Monitor TCP round-trip time across Kubernetes nodes](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time)
- [`trace_tcp` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/)
- [`trace_dns` 官方文档](https://inspektor-gadget.io/docs/v0.54.1/gadgets/trace_dns/)
- [`profile_tcprtt` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/)
- [`trace_tcp` 源码目录](https://github.com/inspektor-gadget/inspektor-gadget/tree/main/gadgets/trace_tcp)
- [`program.bpf.c`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/program.bpf.c)
- [`gadget.yaml`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/gadget.yaml)
- [`README.mdx`（含 connect 架构图）](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/README.mdx)
- [`ebpf/common.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/common.h)
- [`ebpf/connect.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/connect.h)
- [`ebpf/accept.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/accept.h)
- [`ebpf/close.h`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/ebpf/close.h)
- [`trace_tcp_test.go`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go)
- [官方 `run` 输出格式参考](https://inspektor-gadget.io/docs/latest/reference/run/)
- [官方镜像 inspect / eBPF sections 与 maps 示例](https://inspektor-gadget.io/docs/latest/reference/images/)
