---
title: "Unregistry：通过 SSH 直传容器镜像"
date: 2026-08-15
summary: "Unregistry 把临时 OCI Registry、SSH 端口转发与 containerd 镜像存储组合起来，只传远端缺失的镜像层，适合少量 Docker 主机、CI/CD 与隔离网络中的直接发布。"
status: published
tags:
  - docker
  - containerd
  - container-registry
  - ssh
  - deployment
keywords:
  - unregistry
  - docker pussh
  - direct image transfer
  - OCI registry
  - containerd image store
  - SSH tunnel
  - incremental layer transfer
applies_to:
  - "把本地或 CI 构建的 Docker 镜像直接部署到少量远程主机"
  - "不希望维护中心化私有 Registry 的轻量部署"
  - "公网 Registry 不可达、但可通过 SSH 访问目标机的隔离网络"
  - "需要避免 docker save/load 重复传输已有镜像层"
source:
  - url: "https://github.com/psviderski/unregistry"
    type: article
  - url: "https://docs.docker.com/engine/storage/containerd/"
    type: article
---

## 背景

把本地镜像送到服务器，通常要经过公共或自建 Registry；`docker save | ssh ... docker load` 虽然直接，却会重复传完整镜像。Unregistry 面向“只把镜像从 A 搬到 B”的场景：它是一个以 Docker/containerd 本地存储为后端的轻量 Registry，并提供 Docker CLI 插件 `docker pussh`，通过 SSH 将镜像直接推到远端，只传远端缺失的内容寻址层。[项目说明](https://github.com/psviderski/unregistry#readme)

## 核心思想

`docker pussh image user@host` 会建立复用的 SSH 连接，在远端临时启动 Unregistry 容器，把 Registry 端口仅绑定到 `127.0.0.1`，再通过 SSH 把一个本地随机端口转发过去。本地镜像被临时打标签后交给标准 `docker push`；结束时清理标签、临时容器和隧道。[脚本实现](https://github.com/psviderski/unregistry/blob/main/docker-pussh)

服务端复用 Docker Distribution 的 Registry handler，并通过中间件把镜像写入指定 containerd namespace，而不是维护独立 Registry 数据卷。[Registry 入口](https://github.com/psviderski/unregistry/blob/main/registry.go) [containerd 存储实现](https://github.com/psviderski/unregistry/tree/main/internal/storage/containerd)

这是一种“按部署临时建立数据面”的设计：SSH 承担认证与加密，Registry 协议负责协商已有 blob，containerd 成为最终镜像存储。控制资源的生命周期被压缩到一次命令内，因此无需让远端长期监听 Registry 服务。

## 实践要点

- 远端必须运行 Docker，SSH 用户须能直接执行 Docker，或无交互执行 `sudo -n docker`；临时容器需要挂载 containerd socket，并以 root 访问它。[运行要求](https://github.com/psviderski/unregistry#requirements)
- 保留 SSH 主机密钥校验；`--no-host-key-check` 只应用于明确接受中间人风险的临时环境。可用 `-i`、`-F` 和 SSH config 管理密钥、跳板与端口。[命令参数](https://github.com/psviderski/unregistry#usage)
- 优先让远端 Docker 使用 containerd image store，此时推入的镜像可直接使用。若仍使用经典存储，插件会额外在远端 `docker pull`，造成 containerd 与经典存储各留一份数据。[存储行为](https://github.com/psviderski/unregistry#containerd-image-store-configuration)
- CI 中使用不可变标签或摘要并限制部署账户权限；首次运行还需让远端获取匹配版本的 Unregistry 镜像，隔离环境应预先 `docker save/load` 该工具镜像。[离线说明](https://github.com/psviderski/unregistry#requirements)

## 代码示例

```bash
# 构建后直接推到目标机
docker build --platform linux/amd64 -t myapp:1.2.3 .
docker pussh myapp:1.2.3 deploy@prod.example.com

# 指定密钥、SSH 端口和目标平台
docker pussh myapp:1.2.3 deploy@prod.example.com:2222 \
  -i ~/.ssh/deploy_ed25519 --platform linux/amd64
```

## 权衡与反模式

Unregistry 消除了中心 Registry 的账户、端口和持久化运维，也利用 Registry 协议的 blob 去重减少传输；代价是部署端必须获得 SSH 与 Docker/containerd socket 的高权限，规模增大后也缺少中心 Registry 的审计、保留策略、签名验证与跨节点分发能力。因此它更适合少量可信主机，而非通用镜像供应链。

不要把临时 Registry 端口暴露到公网，也不要长期依赖 `latest`。切换 containerd image store 前要确认 Docker 版本与数据路径：Docker 官方指出，新装 Engine 29+ 默认使用该后端，旧版升级仍可能保留经典驱动；切换后旧镜像与容器只是暂时不可见，同时 containerd 会保留压缩和解压层，磁盘规划不能忽略。[Docker 官方文档](https://docs.docker.com/engine/storage/containerd/)

## 参考

- [Unregistry 仓库与 README](https://github.com/psviderski/unregistry)
- [`docker-pussh` 实现](https://github.com/psviderski/unregistry/blob/main/docker-pussh)
- [Registry 与 containerd 存储源码](https://github.com/psviderski/unregistry/blob/main/registry.go)
- [Docker Engine 的 containerd image store](https://docs.docker.com/engine/storage/containerd/)
