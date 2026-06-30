---
title: "KSail：用即弃集群做 Kubernetes 自动化测试"
date: 2026-06-30
summary: "KSail 是一个声明式的本地/CI Kubernetes 集群编排器：单一静态二进制把 Kind/K3d/Talos/KWOK 等发行版、GitOps 投递与安全扫描收敛为同一套命令，让「建集群→部署→验证→销毁」成为可在流水线中复用的自动化测试闭环。"
status: published
tags:
  - kubernetes
  - testing
  - ci-cd
  - gitops
  - automation
keywords:
  - ksail
  - ephemeral cluster
  - kind
  - k3d
  - kwok
  - talos
  - vcluster
  - integration test
  - smoke test
  - workload validate
  - kubescape
  - ttl
  - pr preview
  - github actions
  - kubeconform
applies_to:
  - "为 Kubernetes 工作负载/Operator/Helm Chart 建立 PR 级集成与冒烟测试"
  - "在 CI 中按需拉起即弃集群、跑测试再销毁，避免共享测试集群污染"
  - "把清单校验、安全扫描作为离线 PR 门禁，无需连接真实集群"
  - "用 GitOps（Flux/ArgoCD）端到端验证「提交→ reconcile →就绪」全链路"
source:
  - url: "https://ksail.devantler.tech/start/quickstart/"
    type: article
  - url: "https://ksail.devantler.tech/guides/cicd-integration/"
    type: article
  - url: "https://ksail.devantler.tech/guides/ephemeral-clusters/"
    type: article
  - url: "https://ksail.devantler.tech/guides/pr-preview-clusters/"
    type: article
related:
  - kubernetes/talhelper-talos-bare-metal.md
---

## 背景

Kubernetes 工作负载的自动化测试长期受困于「测试环境」本身：共享测试集群会被并发流水线互相污染、状态难复位；手工拼装 `kind create` + `kubectl apply` + `helm install` 的脚本在不同发行版、不同 GitOps 引擎间无法复用；而清单是否合法、是否合规往往要等集群拉起后才暴露，反馈链路过长。结果是集成测试要么被跳过，要么沦为脆弱的一次性脚本。

KSail（devantler-tech/ksail）正是为弥补这一缺口而生：它是一个**单一静态二进制**的声明式集群编排器，把集群生命周期、工作负载投递、清单校验与安全扫描收敛为同一套命令。其核心定位是「即弃集群（ephemeral cluster）」——在笔记本或 CI 上一条命令拉起一个真实集群，跑完测试即销毁，让 Kubernetes 测试像跑单元测试一样可复现、可丢弃。

## 核心思想

KSail 的关键抽象是**把「测试用的 Kubernetes 环境」变成声明式、可复现、可丢弃的一次性资源**，并让本地与 CI 跑的是同一组命令（"the same commands you run on your laptop"）。

- **声明式集群配置**：`ksail.yaml` 描述发行版、网络、GitOps、registry 等；`kind.yaml`（或对应发行版的原生配置）保留无锁定（no lock-in），可直接喂给底层工具。
- **发行版/Provider 解耦**：同一套命令通过 `--distribution` 切换 Vanilla(Kind)/K3s(K3d)/Talos/VCluster/KWOK/EKS，通过 `--provider` 切换 Docker/Hetzner/AWS 等。测试矩阵因此只是参数变化。
- **离线门禁与在线验证分离**：`workload validate`（kubeconform 模式校验）与 `workload scan`（Kubescape 安全扫描）**完全离线、无需集群**，适合做快速 PR 门禁；需要真实 API 行为时才拉起集群跑集成/冒烟测试。
- **职责边界**：KSail 负责「编排集群 + 投递工作负载 + 校验」，底层发行版负责「运行 Kubernetes」，GitOps 引擎（Flux/ArgoCD）负责「reconcile」。测试验证的是这条真实链路，而非 mock。

## 实践要点

- **最小闭环（本地）**：`ksail cluster init` 脚手架 → `ksail cluster create` 建集群（自动重试瞬时失败）→ `ksail workload apply -k ./k8s` 部署 → `ksail workload get pods` / `logs` 断言 → `ksail cluster delete` 销毁。
- **离线 PR 门禁**：在每个 PR 上跑 `ksail workload validate` 与 `ksail workload scan --framework nsa --compliance-threshold 85`；合规分跌破阈值即让任务失败，把安全回归挡在合并前。多环境要对**每份** config（`ksail.yaml`、`ksail.prod.yaml`）分别校验。
- **CI 中拉起真实集群**：用官方 `ksail-cluster` 复合 Action，一步完成安装 KSail、缓存 Helm chart 与镜像、`init` + `create`；它输出 `kubeconfig` 路径，后续步骤经 `KUBECONFIG` 环境变量用任意工具（kubectl/go test/curl）连上去断言。
- **务必保证清理**：CI 用 `delete: "true"`（内部以 `if: always()` 实现，失败也会销毁）；直接用 CLI 时叠加 `--ttl` 作为安全网，即使 runner 崩溃或任务被取消，集群也会自毁。
- **选发行版按测试目标**：只测控制面/API 行为且要极快启动 → **KWOK**（秒级、不跑真实负载）；要跑真实工作负载又要快 → **K3s**；要严格上游 API 兼容 → **Vanilla(Kind)**；要贴近生产的不可变环境 → **Talos**。
- **失败可观测**：测试失败时用 `if: failure()` 在销毁前 `kubectl logs` 抓取日志；本地调试可对 `--ttl` 进程按 `Ctrl+C` 取消自毁、保留现场。
- **可复现性**：CI 中把 Action 固定到 release tag 或 commit SHA（无浮动大版本 tag 如 `@v7`），并用 `ksail-version` 钉住 KSail 版本。

## 代码示例

GitHub Actions 中的 PR 级集成测试（拉起 → 校验 → GitOps 投递 → 断言 → 自毁）：

```yaml
# .github/workflows/pr-preview.yaml
name: PR Preview Cluster
on:
  pull_request:
    branches: [main]
    paths: ["k8s/**", "ksail.yaml"]   # 仅当 K8s 相关文件变更才拉集群
jobs:
  integration:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write                 # 推送清单到 GHCR 时需要
    steps:
      - uses: actions/checkout@v4
      - name: Provision preview cluster
        id: cluster
        uses: devantler-tech/ksail/.github/actions/ksail-cluster@v7.56.0  # 钉版本
        with:
          distribution: K3s            # K3s 启动最快
          validate: "true"             # 建集群前先校验清单，快速失败
          push: "true"                 # 推送清单到集群本地 OCI registry
          reconcile: "true"            # 触发 Flux/ArgoCD reconcile 并等待就绪
          delete: "true"               # 结束销毁（失败也执行）
          sops-age-key: ${{ secrets.SOPS_AGE_KEY }}   # 可选：解密 SOPS 密钥
      - name: Run integration tests
        env:
          KUBECONFIG: ${{ steps.cluster.outputs.kubeconfig }}
        run: |
          kubectl get pods -n my-app -l app=my-app
          curl -f http://localhost:8080/healthz || exit 1
      - name: Capture logs on failure
        if: failure()
        env:
          KUBECONFIG: ${{ steps.cluster.outputs.kubeconfig }}
        run: kubectl logs -n my-app -l app=my-app --tail=100 || true
```

不依赖复合 Action 时，在任意 runner 上跑同样的命令，叠加 `--ttl` 兜底：

```bash
ksail workload validate                       # 离线门禁
ksail workload scan --framework nsa --compliance-threshold 85
ksail cluster init --distribution K3s
ksail cluster create --ttl 30m                # runner 崩溃也会自毁
# ... 跑测试，断言 ...
ksail cluster delete
```

## 权衡与反模式

- **--ttl 不是 CI 清理手段**：官方明确「自动化 CI 测试不需要 --ttl——建集群、跑测试、显式删除即可」。`--ttl` 仅在进程存活时计时，关终端/杀进程就不会自毁；它在 CI 里只作为「清理步骤被跳过」的安全网，真正的清理应靠 `delete: true` 或显式 `ksail cluster delete`。
- **托管 runner vs 自托管/云 Provider**：托管 runner 上集群随 VM 销毁，`delete` 默认 `false` 即可；**自托管 runner 与 Hetzner/AWS 等云 Provider 必须 `delete: "true"`**，否则泄漏的集群会持续计费。
- **KWOK 的边界**：KWOK 用「假节点」模拟控制面，启动快、省资源，但**不跑真实容器**——只适合测调度/控制面/CRD 行为，不能用它验证真实工作负载的运行时行为。
- **本地通过 ≠ 生产通过**：即弃集群（尤其 Kind/K3d）与生产在 CNI、存储、LoadBalancer、节点 OS 上有差异；端到端兼容性需用贴近生产的 config（Talos + Cilium 等）单独验证。
- **apply 只是学习捷径**：`ksail workload apply` 适合实验，真实环境与可信测试应走 GitOps（`push` + `reconcile`），测的才是「提交→ reconcile →就绪」的真实链路。
- **版本漂移**：把 Action 钉到 `@main` 会让流水线随上游变动而不可复现；CI 应固定到 release tag 或 SHA，并用 `ksail-version` 钉住二进制版本。
- **不要在共享/长存集群上跑破坏性测试**：KSail 的价值正在于「一 PR 一集群、即弃」，复用长存测试集群会重新引入状态污染与串扰。

## 参考

- [KSail Quickstart](https://ksail.devantler.tech/start/quickstart/) — 从零到运行集群的最短路径
- [CI/CD Integration](https://ksail.devantler.tech/guides/cicd-integration/) — 离线门禁 + 有序投递 + GitHub Actions 拉集群
- [Ephemeral Clusters (--ttl)](https://ksail.devantler.tech/guides/ephemeral-clusters/) — 即弃集群与自毁安全网
- [PR Preview Clusters](https://ksail.devantler.tech/guides/pr-preview-clusters/) — `ksail-cluster` Action 与每 PR 预览/测试集群
- [devantler-tech/ksail](https://github.com/devantler-tech/ksail) — 源码、release 与 Action 定义
