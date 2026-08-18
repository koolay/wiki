---
title: "Inspektor Gadget：Kubernetes 网络超时、DNS 与 TCP RTT 的分层诊断"
date: 2026-08-19
summary: "用 Inspektor Gadget 的 trace_dns、trace_tcp、tcpdump 与 profile_tcprtt，把 Kubernetes 网络故障拆成 DNS 链路、TCP 生命周期、报文序列和按节点 RTT 分布，并结合 trace_tcp 的 eBPF hook 理解观测边界。"
status: published
tags:
  - kubernetes
  - networking
  - ebpf
  - observability
  - troubleshooting
keywords:
  - Inspektor Gadget
  - trace_dns
  - trace_tcp
  - tcpdump
  - profile_tcprtt
  - TCP RTT
  - DNS troubleshooting
  - network timeout
  - eBPF
  - CoreDNS
  - Kubernetes network
applies_to:
  - "Kubernetes Pod 间歇性网络超时、连接失败或跨节点通信异常"
  - "需要定位 Pod → kube-dns → CoreDNS → upstream 的 DNS 请求缺口"
  - "需要按 worker node 监控 TCP RTT，并区分网络延迟与应用延迟"
  - "需要理解基于 eBPF hook 的 TCP connect、accept、close 事件采集"
source:
  - url: "https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts"
    type: article
  - url: "https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes"
    type: article
  - url: "https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time"
    type: article
  - url: "https://github.com/inspektor-gadget/inspektor-gadget/tree/main/gadgets/trace_tcp"
    type: article
  - url: "https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/"
    type: article
  - url: "https://inspektor-gadget.io/docs/latest/gadgets/trace_dns/"
    type: article
  - url: "https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/"
    type: article
  - url: "https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/program.bpf.c"
    type: article
  - url: "https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go"
    type: article
---

## 背景

“应用请求超时”不是一个足够具体的故障描述：可能是 DNS 没有响应、TCP SYN 没有回来、端口立即被 RST、连接建立后数据包重传，也可能是网络已经正常而服务端线程、TLS 或数据库协议处理太慢。Inspektor Gadget 的价值在于把同一个现象拆成三种观测层：`trace_dns` 看 DNS 请求/响应链路，`trace_tcp` 看连接生命周期，`tcpdump` 看真实报文序列，`profile_tcprtt` 看已建立连接的 RTT 分布。

因此，现场排障不应一开始就抓全节点流量或只盯着 CoreDNS 的 Running 状态，而应先锁定失败的 namespace、Pod、node、目标名称/IP 和端口，再用低成本事件缩小范围，最后用有边界的抓包验证路径。下面的命令来自 Inspektor Gadget 官方 use-case、文档和 `gadgets/trace_tcp` 官方源码；镜像标签、字段名和过滤器语法应以部署版本的文档为准。

## 核心思想

### 1. 用“事件—报文—分布”三层模型定位故障

- **事件层：** `trace_tcp` 在内核 TCP 函数处观察 `connect`、`accept`、`close`，回答连接是否发起、是否被接受、是否失败或关闭；它还补充 node、namespace、Pod、container、进程和端点上下文。
- **报文层：** `tcpdump` 输出 `pcap-ng`，通过 SYN/SYN-ACK/ACK、RST、重传、丢段和 ACK RTT，区分“没有发出”“被主动拒绝”“握手成功后卡住”和“路径丢包”。
- **分布层：** `profile_tcprtt` 读取 Linux TCP socket 已维护的 smoothed RTT，生成直方图并可持续暴露 Prometheus-compatible 指标，适合发现某个 worker node 的长尾回归。

三层不能互相替代：`trace_tcp` 的成功 connect 不代表应用请求完成，`profile_tcprtt` 不包含 DNS、三次握手、TLS 或服务端处理，抓包也不能直接证明数据库查询耗时。把指标的观测语义和应用的 SLO 分开，是避免错误归因的第一原则。

### 2. DNS 排障要沿同一个 query ID 走完整路径

典型 `dnsPolicy=ClusterFirst` 路径是：应用 Pod → `kube-dns` Service → CoreDNS Pod → upstream DNS → 返回 CoreDNS → 返回应用。`trace_dns` 的 `id`、`qr`、`name`、`rcode`、`addresses`、`latency_ns`、`src` 和 `dst` 用来重建这条路径。CoreDNS 向 upstream 转发时可能出现新的 DNS ID；缓存命中时则可能根本没有 upstream 事件，所以“没看见 upstream 查询”不能单独证明转发失败。NodeLocal DNS 等缓存或转发组件也会改变实际链路。

### 3. 用健康对照把故障边界缩小到 Pod、node 或 endpoint

同一节点一个 Pod 失败而另一个成功，优先看 Pod namespace、sidecar、NetworkPolicy、连接池和 endpoint 选择；所有失败 Pod 都在同一 node，优先看 CNI、conntrack、MTU、路由、NIC 和 node firewall；失败总是跟随同一个数据库 IP，则检查该 endpoint 的 listener、连接上限和路径；只有跨 node 失败，则重点看 overlay 封装、有效 MTU 和节点间防火墙。对照实验比只保存一份失败流量更能回答“哪一层拥有问题”。

## 实践要点

### 一、先用 `trace_dns` 判断 DNS 是无响应、错误、慢还是地址错误

建立一个小而可重复的客户端，分别查询集群内服务、外部域名和明确不存在的名称：

```bash
kubectl create namespace dns-demo

kubectl -n dns-demo run dns-client \
  --image=busybox:1.36 --restart=Never --labels=app=dns-client \
  --command -- sh -c '
    while true; do
      nslookup kubernetes.default.svc.cluster.local >/dev/null 2>&1
      nslookup example.com >/dev/null 2>&1
      nslookup does-not-exist.inspektor-gadget.invalid >/dev/null 2>&1
      sleep 2
    done'

kubectl -n dns-demo wait --for=condition=Ready pod/dns-client --timeout=90s
kubectl gadget run trace_dns -n dns-demo -p dns-client --timeout 10 \
  --filter "qtype==A" \
  --fields k8s.podName,id,qr,qtype,name,rcode,addresses,latency_ns
```

读取结果时，`Q/R` 表示 query/response，`id` 用于配对，`rcode=Success` 只说明解析器返回成功，不说明延迟满足应用预算；`NameError` 等错误码说明“有响应但答案失败”，空 `addresses` 可帮助识别异常答案。`latency_ns` 用于发现慢响应，阈值应按实际 SLO 设定，不要把自拟阈值写成固定的工具语义。

如果范围还不清楚，扩大到所有 namespace，但同时减少字段和设置时间窗口：

```bash
kubectl gadget run trace_dns --all-namespaces --timeout 120 \
  --fields k8s.node,src,dst,name,rcode,latency_ns
```

要看应用到 CoreDNS 再到 upstream 的完整链路，可以同时选择应用和 CoreDNS：

```bash
kubectl gadget run trace_dns \
  -n dns-demo,kube-system \
  -F 'k8s.podName~dns-client|coredns-.*' \
  -F 'name==example.com.' \
  --fields=k8s.node,k8s.namespace,k8s.podName,id,src,dst,qr,name,rcode,timestamp
```

按 `id`、`qr`、`src`、`dst` 逐跳检查：应用到 Service 证明请求离开应用；Service 到 CoreDNS 证明服务路由生效；CoreDNS 到 upstream 证明发生转发；反向响应缺失则把边界放在对应的返回路径。输出不保证按 `timestamp` 排序，因此不要把终端排列顺序当成严格时间序列。DNS over TCP 还存在局限：官方 `trace_dns` 不做 TCP stream reassembly，跨多个 TCP packet 的查询无法完整解析。

### 二、用 `trace_tcp` 看连接生命周期，而不是猜应用状态

```bash
kubectl gadget run ghcr.io/inspektor-gadget/gadget/trace_tcp:latest \
  --connect-only --failure-only -A -o json
```

`trace_tcp` 支持 `--accept-only`、`--connect-only` 和 `--failure-only`，默认都为关闭；`-A` 可避免只观察 `default` namespace 而漏掉事件。默认表格包含 `K8S.NODE`、`K8S.NAMESPACE`、`K8S.PODNAME`、`K8S.CONTAINERNAME`、`SRC`、`DST`、`COMM`、`PID`、`TID`、`UID`、`GID` 和 `TYPE`。结构化输出还可包含 `timestamp`、`src/dst` 的地址/端口/协议版本、`type`、运行时和 Kubernetes 元数据；集成测试验证的完整事件 schema 还包括 `Error`、`Fd`、`AcceptFd` 和 `NetNsID`。

常见解释是：立即 RST/失败更像 listener、策略或中间设备主动拒绝；SYN 发出却没有响应要转向路径、网络策略、MTU、CNI 或防火墙；握手完成但应用仍超时，则检查 TLS、服务端排队、数据库处理或连接池。`connect` 事件本身不是请求完成事件。

### 三、对明确的 Pod、端口和 endpoint 做有限抓包

确认失败对象后再抓包，官方示例把 namespace、Pod、目标端口、目标 IP 和 30 秒窗口都写进命令：

```bash
kubectl gadget run tcpdump \
  --namespace production \
  --podname backend-service-7d9c8f \
  --pf "tcp port 5432 and host 10.20.30.40" \
  --timeout 30 -o pcap-ng > db-timeout.pcapng

tcpdump -nn -r db-timeout.pcapng
wireshark -r db-timeout.pcapng
```

Wireshark 中可先看：

```text
tcp.flags.syn == 1
tcp.flags.reset == 1
tcp.analysis.retransmission
tcp.analysis.lost_segment
tcp.analysis.ack_rtt
```

SYN/SYN-ACK/ACK 是否完整回答握手；RST 说明主动拒绝或关闭；重传/丢段提示丢包、拥塞、MTU、overlay 或防火墙；握手正常而后续 ACK/数据停顿，则不要把所有时间继续花在 DNS。Inspektor Gadget 的 Wireshark dissector/extcap 还能携带 namespace、Pod、container、node 上下文，减少用短生命周期 Pod IP 反查 workload 的工作。抓包应至少覆盖一次失败，并注意 payload 可能含有敏感数据。

### 四、需要趋势时用 `profile_tcprtt`，并保留 node 维度

交互式节点快照：

```bash
kubectl gadget run profile_tcprtt:latest --node minikube-docker
```

该 Gadget 以指数区间输出 `count` 和 distribution，单位是微秒；统计的是已经 established 的连接中的 TCP RTT operation，不包含三次握手。若目标是连接建立耗时，应使用连接跟踪 Gadget 的 latency 能力，而不是把 `profile_tcprtt` 当作握手指标。

连续采集可在 Gadget operator 中开启 metrics endpoint，并创建不超时的 `profile_tcprtt` 实例：

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

Prometheus 侧用 `PodMonitor` 抓每个 Gadget Pod 的 `/metrics`，把 Pod 所在 worker node 重标记为 `instance`，并删除 `pod/container/namespace` 等会造成高基数或错误切分的标签：

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
        - sourceLabels: [__meta_kubernetes_pod_node_name]
          targetLabel: instance
      metricRelabelings:
        - action: labeldrop
          regex: '(pod|container|namespace)'
```

官方 use-case 的 p95 思路是先对 histogram bucket 做 `rate()`，再按 `instance,le` 求和，最后 `histogram_quantile(0.95, ...)`；若当前指标以微秒暴露，再除以 1000 转毫秒。实际部署前要检查指标单位和名称，不要盲目复制 PromQL。

### 五、现场推荐顺序

1. 记录失败 namespace、Pod、node、DNS 名称/IP、目标端口和健康对照。
2. 先用 `trace_dns` 判断无响应、错误码、慢响应或错误地址。
3. 再用 `trace_tcp --connect-only`/`--failure-only` 判断连接是否发出和失败。
4. 对明确的 Pod、端口、endpoint 使用限时 `tcpdump`，核对握手、RST、重传和 ACK RTT。
5. 只有需要长期趋势时才开启 `profile_tcprtt` metrics，并按 node 比较 p95/p99。
6. 按 Pod-specific、node-specific、endpoint-specific、cross-node 或“TCP 健康但应用慢”把问题交给对应 owning team。

## 代码示例

`trace_tcp` 的实现不是轮询 `/proc/net/tcp`，而是用 eBPF hook 采集内核 TCP 生命周期事件。`program.bpf.c` 注册了 IPv4/IPv6 connect 的 `kprobe/kretprobe`、`tcp_close`、`tcp_set_state`、`inet_csk_accept`，并用 syscall enter/exit tracepoint 关联文件描述符和线程：

```c
SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(ig_tcp_v4_co_e, struct sock *sk) {
  return enter_tcp_connect(ctx, sk);
}

SEC("kretprobe/tcp_v4_connect")
int BPF_KRETPROBE(ig_tcp_v4_co_x, int ret) {
  return exit_tcp_connect(ctx, ret, AF_INET);
}

SEC("kprobe/tcp_set_state")
int BPF_KPROBE(ig_tcp_state, struct sock *sk, int state) {
  handle_tcp_set_state(ctx, sk, state);
  return 0;
}

SEC("kretprobe/inet_csk_accept")
int BPF_KRETPROBE(ig_tcp_accept, struct sock *sk) {
  handle_tcp_accept(ctx, sk);
  return 0;
}
```

同步 connect 在 `sys_connect` 返回前经过 `tcp_set_state`；异步 connect 则在系统调用返回后由后续状态转换完成。源码和 README 的架构图显示，临时上下文会经过 `tuplepid`、`sockets` 等 map，最终通过 `events` RingBuf 送到用户空间；镜像 inspect 示例还列出 `gadget_heap` 和 `gadget_mntns_filter_map`。`accept` 通过 `inet_csk_accept` 的返回值拿到新 socket，`close` 通过 `tcp_close` 生成关闭事件。

这解释了两个实践选择：一是用 `-o json` 和显式字段消费结构化事件，避免把默认表格误当成完整 schema；二是把 `-n/-A/-p/--node/--containername` 与 `--fields/-F/--filter` 结合使用，让内核观测范围和 Kubernetes 解释范围都可控。官方文档将 `trace_tcp`、`trace_dns` 和 `profile_tcprtt` 的最低尝试内核版本都列为 **5.4**；旧版本是否工作仍取决于内核 hook、BTF、BPF verifier、运行时 ABI 和具体 Gadget 版本。

## 权衡与反模式

- **把 TCP RTT 当成端到端延迟：** RTT 只反映已建立 TCP socket 的内核平滑 RTT；它不包括 DNS、SYN、TLS、服务端排队、数据库执行和应用序列化。应用慢而 RTT 稳定时，应转向应用、依赖容量和连接池。
- **只看 CoreDNS Pod 是否 Running：** Pod 健康不等于某个 DNS 请求沿 Service、CoreDNS、upstream 和返回路径都成功。应按 query ID、Q/R、rcode、src/dst 和 latency 重建路径。
- **把没有 upstream 事件当成 upstream 故障：** CoreDNS cache 命中、NodeLocal DNS 或不同 CNI 拓扑都可能使 upstream 事件缺失；必须结合实际部署解释。
- **默认全局抓包或全 namespace 追踪：** 事件噪声、文件大小和敏感 payload 暴露面都会增加。优先使用 namespace/Pod/node/endpoint/端口/时间窗口过滤，确认问题后再扩大范围。
- **把 `connect` 成功当作请求成功：** 连接可能在 TLS、服务端协议、数据库线程池或读取响应阶段超时；需要抓包和应用 trace 继续向上层验证。
- **忽视对照 Pod 和节点维度：** 单份失败样本无法说明问题是 Pod、node 还是 endpoint；健康 replica、跨节点/同节点对照和 node-label 聚合是低成本的归因手段。
- **忽略运行权限和内核差异：** Kubernetes 入口与本地 `sudo ig` 都要求 Gadget 能在目标节点加载和运行；官方集成测试的本地容器使用 privileged。不要凭经验硬编码一组跨版本的 Linux capability，应以目标版本部署清单和实际加载错误为准。
- **忽视 DNS over TCP 和指标单位：** `trace_dns` 不做 TCP stream reassembly；`profile_tcprtt` 的 histogram 单位与暴露名称应在当前版本检查，PromQL 的 `/1000` 不能无条件照搬。

## 参考

- [Diagnose intermittent Kubernetes network timeouts](https://inspektor-gadget.io/use-cases/diagnose-kubernetes-network-timeouts) — 限定 Pod/端口抓 `pcap-ng`，用握手、RST、重传和对照流量定位超时。
- [Troubleshoot DNS in a Kubernetes cluster](https://inspektor-gadget.io/use-cases/troubleshoot-dns-in-kubernetes) — 用 `trace_dns` 追踪应用、CoreDNS 和 upstream 的 DNS 请求链路。
- [Monitor TCP round-trip time across Kubernetes nodes](https://inspektor-gadget.io/use-cases/monitor-tcp-round-trip-time) — 配置 `profile_tcprtt`、OpenTelemetry metrics、PodMonitor 和按 node 的 histogram 查询。
- [`trace_tcp` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_tcp/) — 命令入口、过滤参数、默认输出、内核版本和示例。
- [`trace_dns` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/trace_dns/) — DNS 组件模型、字段、过滤、DNS ID 关联与 TCP 限制。
- [`profile_tcprtt` 官方文档](https://inspektor-gadget.io/docs/latest/gadgets/profile_tcprtt/) — smoothed RTT、已建立连接、直方图区间和微秒单位。
- [`trace_tcp` 源码目录](https://github.com/inspektor-gadget/inspektor-gadget/tree/main/gadgets/trace_tcp) — Gadget 清单、eBPF 程序、文档、测试和实现依赖。
- [`program.bpf.c`](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/program.bpf.c) — connect、accept、close、state-change 的 kprobe/kretprobe 与 syscall tracepoint。
- [`trace_tcp` 集成测试](https://github.com/inspektor-gadget/inspektor-gadget/blob/main/gadgets/trace_tcp/test/integration/trace_tcp_test.go) — 事件结构、connect/accept/close 字段和本地 privileged 测试环境。
