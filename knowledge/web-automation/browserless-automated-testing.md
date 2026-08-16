---
title: "Browserless：把浏览器当服务跑自动化测试"
date: 2026-07-01
summary: "Browserless 是用 Docker 部署的无头浏览器服务（BaaS），让 Puppeteer/Playwright/Selenium 脚本只改连接串即可连到托管浏览器，免去字体、崩溃、依赖与扩容之苦。本文讲清它的 connect 连接模型、launch 参数、等待与稳定性范式、并发与超时治理、自托管 Docker 部署及 CI 集成与能力边界。"
status: published
tags:
  - testing
  - web-automation
  - headless-browser
  - playwright
  - puppeteer
  - docker
  - ci-cd
keywords:
  - browserless
  - browsers as a service
  - baas
  - headless chrome
  - puppeteer-core
  - playwright-core
  - connectOverCDP
  - browserWSEndpoint
  - browserless docker
  - ghcr.io/browserless/chromium
  - concurrency
  - timeout
  - waitForSelector
  - waitUntil
  - end-to-end test
  - e2e
  - selenium
  - chromedp
applies_to:
  - "已有 Puppeteer/Playwright/Selenium 脚本，想在云端或集中式服务上跑 E2E/冒烟测试而不自管浏览器基础设施"
  - "在 CI 中需要稳定、可扩容地并行拉起大量浏览器会话做回归测试"
  - "为依赖 JS 渲染、登录态、代理或地域定向的页面编写端到端测试"
  - "希望自托管（Docker）一个浏览器池供团队/流水线共享，并治理并发、超时与资源"
  - "判断 Browserless 与本地 Headless Chrome、Lightpanda 等运行时在测试场景下的取舍"
source:
  - url: "https://github.com/browserless/browserless"
    type: article
  - url: "https://docs.browserless.io/baas/start"
    type: article
  - url: "https://docs.browserless.io/baas/launch-options"
    type: article
  - url: "https://docs.browserless.io/baas/best-practices"
    type: article
  - url: "https://docs.browserless.io/enterprise/docker/enterprise-image"
    type: article
related:
  - web-automation/lightpanda-automated-testing.md
---

## 背景

在 CI 或服务器上跑 Chrome 做自动化测试，痛点几乎是固定的：缺字体、随机崩溃、系统依赖地狱、Lambda 限制、Chrome 实例随时间泄漏内存、并发会话争抢 CPU/RAM，还要持续打安全补丁和处理 CVE。结果是测试团队把大量精力花在「让浏览器能稳定跑起来」上，而不是写用例。

Browserless（browserless/browserless，13k+ star，SSPL/商业双许可）把浏览器本身抽象成一个**服务（Browsers as a Service, BaaS）**：它用 Docker 打包好 Chromium/Chrome/Firefox/WebKit/Edge 及全部系统包、字体、emoji 与扩容策略，对外暴露一个 WebSocket 端点。你的测试脚本不再在本机 `launch` 一个浏览器，而是用标准的 Puppeteer/Playwright/Selenium **连接（connect）**到这个端点——脚本主体一行不用改，只换连接串。它既可以用官方云（自助/企业版），也可以自托管 Docker 镜像，「你拥有脚本，它负责让浏览器稳定运行」。

关键定位：Browserless 不是测试框架，而是**测试用的浏览器运行时与会话池**。断言、用例、测试运行器仍由你的 Playwright/Jest/Vitest/PyTest 负责。

## 核心思想

理解 Browserless 在测试栈里的用法，抓住四条主线：

- **attach 而非 launch**：本地开发常写 `puppeteer.launch()` / `chromium.launch()`，Browserless 下改为 `puppeteer.connect({ browserWSEndpoint })` 或 Playwright 的 `chromium.connectOverCDP(wsEndpoint)`。浏览器由服务端启动并托管，客户端只是接管控制权。这是所有集成方式的根本姿势。

- **连接串即配置**：token、浏览器类型、超时、代理、stealth、隐身等几乎所有「启动参数」都编码进 WebSocket URL。浏览器类型靠 **路径** 选择（`/chromium`、`/chrome`、`/stealth`、`/firefox/playwright`、`/webkit/playwright`、`/edge/playwright`），其余靠 **查询参数** 或一个编码后的 `launch` JSON 对象（等价于本地的 `launch({options})`）。所以「换浏览器/换配置」往往只是改 URL。

- **会话池有边界，必须收尾**：服务按 **并发数（concurrent）** 和 **排队数（queued）** 治理资源。每个不关闭的会话都占用一个并发槽；累积未关闭会话会触发 `429 Too Many Requests`。因此「在 `finally` 里 `browser.close()`」不是可选项，而是测试稳定性的硬约束。

- **云端与自托管同构**：云端连 `wss://production-sfo.browserless.io?token=...`，自托管连 `ws://localhost:3000`（或加 `?token=`）。脚本主体一致，迁移成本极低——本地 Docker 调通即可平滑搬到云端或集群。

此外，除 WebSocket 驱动模式外，Browserless 还提供 **REST API**（`/screenshot`、`/content`、`/pdf`、`/function` 等），适合不需要复杂分支逻辑的一次性任务（如视觉快照、抓取 HTML），可作为轻量断言的补充。

## 实践要点

- **跑起服务**：自托管最快路径是开源镜像 `docker run -p 3000:3000 ghcr.io/browserless/chromium`，访问 `http://localhost:3000/docs` 验证，端点即 `ws://localhost:3000`。Firefox/WebKit 用 `ghcr.io/browserless/firefox` 或 `ghcr.io/browserless/multi`。云端则注册后拿 token，连区域端点（就近选择以降延迟）。

- **用对客户端包**：务必使用 `puppeteer-core` / `playwright-core`，它们不会附带下载本地 Chromium——浏览器在服务端，本地无需。

- **选浏览器靠路径，配参数靠 URL**：简单开关用查询参数（`&timeout=300000&blockAds=true`）；`args`、`headless`、`stealth`、`slowMo` 等浏览器级选项放进 `launch` JSON 并 URL 编码或 base64 编码后作为 `launch=` 传入。两者可叠加，查询参数优先级更高。可用 Chrome flags 包括 `--window-size`、`--lang`、`--proxy-server`、`--disable-web-security` 等。

- **优先显式等待，拒绝 sleep**：动态内容用 `page.waitForSelector(sel)`（出现）或 `{ hidden: true }/state:'hidden'`（消失），数据来自接口时用 `page.waitForResponse(...)`，自定义完成信号用 `addEventListener` + `page.evaluate`。导航的 `waitUntil` 从 `domcontentloaded` 起步，仅在确有需要时升级到 `networkidle2`/`networkidle`，否则忙碌页面易超时。

- **减少网络往返**：客户端到远程浏览器的每个 `await`（`click`、`textContent`…）都是一次 WebSocket 往返。把多步 DOM 操作合并进单个 `page.evaluate(() => {...})` 内一次执行、一次性返回结果，延迟随操作数线性下降——这是远程浏览器相比本地浏览器尤其重要的性能点。

- **治理并发与超时**：连接串里 `timeout`（毫秒）控制单会话最长时长；服务端并发受 plan/部署的 `CONCURRENT` 约束（云端 Free 2、Starter 30、Scale 80+）。**始终在 `finally` 中关闭会话**，否则未释放的槽位累积会导致 `429`。失败请求在仪表盘显示为 Rejected。

- **登录态、代理与地域**：用保存的认证 Profile（`profile=`，云端经 `POST /profile` 创建）注入 cookie/localStorage；`proxy=residential|datacenter` + `proxyCountry=us` 做地域定向测试；`blockAds=true` 用内置 uBlock 去广告、加速并减少干扰。

- **CI 集成**：自托管时把 Browserless 作为流水线里的一个 service 容器（或常驻服务）跑，测试连其端点；生产容器记得 `--shm-size=2g` 提升 `/dev/shm`，避免 Chrome 在压力下崩溃。云端则只需把 `BROWSERLESS_WS` 注入为 secret，按需调连接串。

## 代码示例

Playwright E2E：连接 Browserless，执行「访问 → 等待动态内容 → 断言」，并在 `finally` 严格收尾（适配云端或自托管，仅连接串不同）：

```js
import { test, expect } from '@playwright/test';
import { chromium } from 'playwright-core';

// 云端：wss://production-sfo.browserless.io?token=YOUR_TOKEN
// 自托管：ws://localhost:3000
const WS = process.env.BROWSERLESS_WS ?? 'ws://localhost:3000';

test('搜索能渲染出动态结果', async () => {
  // attach 到托管浏览器，而非 launch
  const browser = await chromium.connectOverCDP(WS);
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 起步用 domcontentloaded，够用就不要 networkidle
    await page.goto('https://news.ycombinator.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.locator('input[name="q"]').fill('browserless');
    await page.keyboard.press('Enter');

    // 显式等待动态结果，而非 sleep
    await page.waitForSelector('.Story_title', { timeout: 5000 });

    const titles = await page.locator('.Story_title').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
  } finally {
    // 关闭会话，释放并发槽；否则累积会触发 429
    if (browser.isConnected()) await browser.close();
  }
});
```

Puppeteer + `launch` 对象（窗口尺寸/语言/隐身），并把多步操作合并为单次 `evaluate` 减少往返：

```js
import puppeteer from 'puppeteer-core';

const launch = btoa(
  JSON.stringify({ args: ['--window-size=1280,720', '--lang=en-US'], stealth: true })
);
const WS =
  process.env.BROWSERLESS_WS +
  `?token=${process.env.BROWSERLESS_TOKEN}&launch=${launch}&timeout=120000`;

const browser = await puppeteer.connect({ browserWSEndpoint: WS });
try {
  const page = await browser.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

  // 单次往返内完成多步读取与断言数据
  const result = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return { title: document.title, heading: h1?.innerText, links: document.links.length };
  });
  console.assert(result.heading?.includes('Example'), '页面标题应符合预期');
} catch (err) {
  console.error('自动化失败：', err.message);
} finally {
  if (browser.isConnected()) await browser.close();
}
```

自托管最小部署（开发态）与生产 Docker Compose（治理并发/超时/共享内存/健康检查）：

```bash
# 开发态：一行起服务，端点 ws://localhost:3000
docker run -p 3000:3000 --shm-size=2g ghcr.io/browserless/chromium
```

```yaml
# 生产态（要点：TOKEN 鉴权、CONCURRENT/QUEUED/TIMEOUT 治理、shm_size 防崩溃、健康检查）
services:
  browserless:
    image: ghcr.io/browserless/chromium:latest
    restart: unless-stopped
    environment:
      - TOKEN=${BROWSERLESS_API_TOKEN}   # 对外暴露务必开启鉴权
      - CONCURRENT=10                    # 并发会话上限，按 CPU/内存调
      - QUEUED=20                        # 超并发后的排队上限
      - TIMEOUT=300000                   # 单会话最长 5 分钟
    ports:
      - "3000:3000"
    shm_size: "2g"                       # 提升 /dev/shm，避免 Chrome 崩溃
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/pressure"]
      interval: 30s
      timeout: 10s
      retries: 3
```

REST API 做一次性视觉/内容断言（无需写驱动脚本）：

```bash
# 截图（视觉冒烟）
curl -X POST "http://localhost:3000/screenshot?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","options":{"fullPage":true}}' \
  --output shot.png

# 拿渲染后 HTML 做结构断言
curl -X POST "http://localhost:3000/content?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

## 权衡与反模式

- **反模式：忘记 `close`**。每个未关闭会话占一个并发槽，CI 里很快累积成 `429 Too Many Requests`。把 `browser.close()` 放进 `finally`，并配合 `isConnected()` 判断，是最常见也最致命的坑。

- **反模式：用 `launch` 而非 `connect`**。Browserless 的姿势是连接托管浏览器；继续写 `puppeteer.launch()`/`chromium.launch()` 会绕开服务、回退到本地浏览器，失去全部价值。

- **反模式：固定 `sleep` 等渲染**。脆且慢。始终用 `waitForSelector`/`waitForResponse`/`waitForLoadState`，并设合理 `timeout`。

- **`networkidle` 不是银弹**：在持续有后台请求（轮询、分析、广告）的页面上用 `networkidle0`/`networkidle` 会一直等不到空闲而超时。优先 `domcontentloaded` + 精确选择器等待。

- **网络往返是远程模式的固有成本**：远程浏览器比本地多了一跳网络。能合并进 `page.evaluate` 的多步操作就合并；就近选区域端点；这点在高频交互用例里显著影响耗时。

- **许可与成本边界要看清**：源码是 SSPL/商业双许可——闭源商用或在闭源 CI 系统里使用需购买商业许可。云端按用量计费且有 plan 级的并发、单会话时长（Free 仅 1 分钟）限制；**截图/录屏、持久化 Session、隐身高级路由、住宅代理、验证码求解、Session Replay、Webhook 等多为云端自助/企业版能力**，开源自托管镜像聚焦核心自动化。规划测试矩阵时先确认目标特性属于哪个层级。

- **安全：对外暴露务必开 `TOKEN`**。自托管若把 `3000` 暴露到公网而不设 token，等于开放一个可访问任意 URL、可被滥用为 SSRF/抓取跳板的浏览器服务。生产部署应启用 token 鉴权、按需关闭 `ALLOW_GET`/`ENABLE_CORS`、放在内网或加反向代理。

- **资源与稳定性**：Chrome 用 `/dev/shm`，Docker 默认仅 64MB，压力下易崩溃，生产务必 `--shm-size=2g`；并发别超配，按 CPU/内存（经验值约每会话 0.3–0.5 核 + 数百 MB）设 `CONCURRENT`，超出用 `QUEUED` 排队而非拒绝。

- **与轻量运行时的取舍**：若用例只需 DOM/JS/数据层断言、且追求极致低内存与高并发，[Lightpanda](lightpanda-automated-testing.md) 这类无渲染运行时更省资源；但涉及真实 Chrome 行为、像素级视觉回归、多浏览器（Firefox/WebKit/Edge）兼容性矩阵、登录态/代理/隐身等完整能力时，Browserless 的「真浏览器即服务」更合适。

## 参考

- 源码仓库与特性总览（开源/企业/云端部署模型）：https://github.com/browserless/browserless
- BaaS 介绍（connect 模型、浏览器端点、会话限制）：https://docs.browserless.io/baas/start
- Launch Options（查询参数、`launch` 对象与编码、Chrome flags）：https://docs.browserless.io/baas/launch-options
- Best Practices（并发与超时治理、等待范式、减少往返、HTTP 错误码）：https://docs.browserless.io/baas/best-practices
- 自托管 Docker 部署（环境变量、Compose、`shm_size`、连接方式）：https://docs.browserless.io/enterprise/docker/enterprise-image
