---
title: "Loop Engineering：让 AI Agent 自己运转的循环设计"
date: 2026-06-30
summary: "把 coding agent 从「手动操作」升级为「自运转系统」：分离 planner/generator/evaluator 角色、先协商可验收契约、状态写盘可崩溃续接、目标驱动 + 独立 grader 闭环，按开/闭环与单 agent/编队选型，让人只保留目标、标准与合并键。"
status: published
tags:
  - ai-agents
  - agentic-workflow
  - automation
  - coding-agent
keywords:
  - loop engineering
  - autonomous agent
  - generator evaluator pattern
  - independent grader
  - contract negotiation
  - goal
  - state file
  - taste rubric
  - trace reading
  - guardrails
  - cost per accepted change
  - open loop vs closed loop
  - single agent vs fleet
  - orchestrator subagents
  - worktrees
  - connectors
  - token cost
applies_to:
  - "把重复且可自动验证的开发任务（CI 三分类、依赖升级、lint 修复）交给 agent 自运转"
  - "为长跑（数小时/数天）agent 设计角色分离、可验收契约、跨轮记忆与停止条件"
  - "给无人值守的 agent 循环加权限/钩子护栏、控制成本并调试循环本身"
  - "在单 agent 与 orchestrator+specialist 编队、开环与闭环之间做选型与成本权衡"
source:
  - url: "https://www.requesty.ai/blog/loop-engineering-how-to-build-ai-agent-loops-that-run-themselves"
    type: article
---

## 背景

多数人用 coding agent 的方式是：输入请求 → 看它干活 → 读 diff → 再输入下一条，人始终坐在椅子上，agent 干三十秒就停下来等你。这意味着**人本身仍然是那个循环**。瓶颈往往不是模型而是「手动操作」这个姿势——正如 Karpathy 在 LOOPS.md 中所说，多数 agent 系统死于弱 harness 而非弱模型：模型能写代码、能审代码、能对照十分钟前认可的 rubric 验收自己，唯独不能自己决定何时停、何时重来、结果写到哪，那正是循环的工作。

下一步不再是「prompt 这个 agent」，而是「设计那个去 prompt agent、检查结果、决定下一步、跑到通过为止的循环」。Anthropic Claude Code 负责人 Boris Cherny 把它说得很直白：「我已经不再 prompt Claude 了——我有一堆循环在 prompt Claude 并自己决定做什么，我的工作是写循环。」一句话概括：**循环就是系统替你发出的那条 prompt**。Prompt 给 agent 一条指令；Loop Engineering 给 agent 一份工作。

## 核心思想

Loop Engineering 把工作从「操作工具」上移一层到「设计运转工具的系统」：决定 agent 做什么、何时做、用什么 check、轮次之间记住什么。它把循环当成一等对象——角色分离、状态在磁盘、契约在写第一行代码前协商、出错时像读 stack trace 一样读 harness。模型本身不变，所有可改进的部分都在你包在它外面的那个循环里。

**五个阶段**构成最小骨架：Discover → Plan → Execute → Verify → Iterate（发现 → 计划 → 执行 → 验收 → 迭代），过则 ship，不过则打回继续；Karpathy 把同一节奏概括为 gather → reason → act → verify → repeat，其余一切都是这五个动词的脚注。关键不是一条完美 prompt，而是一个不断把不合格产出逼到合格的系统。

循环有两个选型维度。**规模**上分单 agent 循环（一个脑子自我改进，适合 bug 修复、研究摘要、内容草稿等聚焦小任务）与 fleet 编队（一个 orchestrator 拆任务派给 research / engineering / QA 等 specialist，specialist 再用更小的 subagent，像一支端到端跑项目的小团队）。**形态**上分开环（exploratory，给宽目标让它自己找路，能发现你没指定的东西，但烧 token、易跑偏、难控）与闭环（bounded，人先把路径、步骤、每步评估、停止条件、卡住时的 hand-off 定好，再让它自己跑）。**先做闭环——更便宜、更可靠、产出更干净；等 check 足够强，再把环打开。**

最后，**瓶颈会移动**：coding 不再是瓶颈时，planning 成为瓶颈；planning 解决了，verification 成为瓶颈；verification 自动化了，taste（品味）成为瓶颈。你不会「做完」，只是不断让下一个瓶颈显形——如果一切都很顺，说明你看得不够仔细。

## 实践要点

**第一阶段·决定是否要建循环**

- **先过四条件测试**：任务重复、验证可自动化（测试/类型检查/lint/构建）、预算能吸收浪费、agent 有真实工具（日志、能跑代码看报错）。缺一条就别建循环，一发好 prompt 更划算。
- **选对活**：适合无聊且机器可判定的任务——CI 失败三分类、依赖升级、PR lint-fix、flaky 测试复现；不适合需要判断的活——架构重写、认证/支付、生产部署。
- **先闭环再开环**：先用 bounded 闭环跑出可靠收益，等 check 足够强再放开探索空间，否则开环会试太多路径、快速产出低质内容并漂离目标。

**第二阶段·把核心搭可靠**

- **先把单次手动运行做可靠**：循环会把底层的每个弱点乘上运行次数。先固化标准事实（CLAUDE.md）、接好工具、明确验收物，再去 loop 它。
- **分离三个角色（三套上下文、三个 system prompt）**：planner 把模糊的人话变成 sprint spec、绝不碰代码；generator 写一切、禁止给自己打分；evaluator 读 diff、跑 playwright、玩这个 app，并被预设「代码是坏的，你的任务是证明它坏」。混用角色是最常见的失败——模型一旦给自己打分就变谄媚，循环悄悄收敛到 slop。
- **先协商契约**：generator 写第一行前先提出「done 长什么样」，evaluator 反驳，双方用磁盘上的 markdown 互相争论，直到敲定一份**可测试断言的清单**（小 app 约 27 条合理；10 条太少、evaluator 会橡皮图章式放行）。planner 的原始 spec 是边界，但被打分的是契约——这一条能把运行从「能演示的残品」推到「能用的产品」。
- **给目标 + 独立 grader**：停止条件不能是「agent 自觉做完了」。关键词是 independent——验收者不能是干活的那个；它在干净上下文里只看产物和标准、自己跑测试、不许手软。
- **写盘而非写上下文**：context window 会撒谎——它会压缩、腐烂、把一小时前的话藏进你没写的摘要里；磁盘上的文件不会。保留 `feature_list.json`、`progress.md`、`contract.md` 和只追加的 `log.md`。检验标准：模型崩溃、丢会话后，**靠读三个文件就能续接**；若状态无法用三个文件描述，说明状态太复杂。
- **允许循环重启**：当前前沿模型最好的行为之一，是在跑偏时愿意把一切扔掉重来。别打断它——重启就是循环在正确工作。只有当**契约本身错了**才插入人类，而不是 build 坏了的时候。

**第三阶段·让它安全且复利**

- **上定时、再上云**：`/loop 30m` 拉新失败测试、在分支起草修复、交给 verifier，目标如 `main is green`；云端 routine 让机器关着也能跑。timer 把一次运行变成习惯，云端把习惯变成基础设施。
- **给会续接的记忆并蒸馏成 skill**：状态文件是项目级记忆，结束前写、开始时读；通用教训再「毕业」成跨项目 skill（含已知失败模式与反模式），让每个未来循环都站在过去学到的东西上。
- **给可恢复主观的评分（taste rubric）**：品味写下来就可评分。四个加权轴——design / originality / craft / functionality，用 3 个「好」站点和 3 个「slop」站点校准，输出 0–1 的分数加一段解释差距的话。模型不会发明品味，只会向你描述的品味收敛——把 rubric 写得足够细，使「向它收敛」恰好是你想要的，这才是整个游戏。
- **读 trace**：几乎所有关于 agent 循环的调试洞见都来自读原始 transcript，而非再跑一次实验。把输出导入文件，grep 出它的判断与你分歧的那一刻，针对那一刻改 prompt，再跑。这和读 stack trace 是同一块肌肉，只是 trace 用英文写、且多数是模型在自言自语；跳过这步就是在凭 vibe 调参。
- **删 harness**：harness 是为补偿模型而存在的。模型变强后，上季度写的一半东西会变成开销——上一代靠会话间重置上下文，下一代不需要；sprint 拆解曾是撑住四小时构建的唯一办法，对能在脑中保持两小时的模型则成了约束。每出新版本就拿 harness 重读一遍，删掉模型现在免费就能做的部分。**单调增长的 harness，是你已经不再读的 harness**。

**贯穿全程·工程构件、护栏与成本**

- **六个工程构件**：自动化（heartbeat：定时 / PR 打开 / 文件变更 / 有新 ticket 时触发）、worktree（多 agent 并行编辑时各给独立工作区与分支，避免互相覆盖把 repo 搞乱）、skill（复用的项目知识：愿景/架构/规则/构建与测试步骤/绝不能做的事）、plugin & connector（接通 GitHub/Slack/Linear/Jira/DB/staging API，从「这是建议的修复」升级到「我开了 PR、关联了 ticket、盯了 CI、发了更新」）、subagent（maker 与 checker 用不同模型）、memory（跨轮记忆，落在 markdown/issue/DB）。
- **加护栏**：无人值守循环 = 无人值守攻击面。用 permission 的 allow/deny 列表 + PreToolUse hook 把不可逆操作挡在墙外（hook 是模型无法用话术绕过的墙），人只保留合并键和任何不可撤销的动作。
- **按成本路由**：orchestrator 用重型模型，高频 pass、分类、验收用便宜模型，再给顶级模型拒绝的任务留一个 fallback。
- **正视 token 账单并只盯一个指标**：循环靠重试、自纠、验收、subagent 烧 token——单个中等编码循环约 50K–200K，fleet 约 500K–2M，每日定时循环每周可达数百万；让它天天跑的前提是廉价输入/输出 token + 大上下文 + tool calling + JSON 输出 + 高并发。唯一要紧的指标是 **cost per accepted change**（每次被接受的变更成本），接受率低于一半说明你在做循环本该省掉的审查，循环就在亏。

## 代码示例

```yaml
# 独立 verifier/evaluator subagent：另起干净上下文，预设「代码是坏的，去证明它」
---
name: verifier
description: Independent check of the maker's output against the contract. Use every iteration.
tools: Read, Grep, Bash
---
You did not produce this work. The code is broken until proven otherwise.
Check it against contract.md and the project rules. Run the tests and the
app yourself. Report a 0..1 score per axis (design/originality/craft/
functionality) with concrete reasons and file references. Do not be generous.
```

```text
# 磁盘状态：崩溃后靠读这几个文件就能续接（写盘而非写上下文）
feature_list.json   # 计划要做的特性
contract.md         # planner↔evaluator 协商出的可测试断言清单（被打分的就是它）
progress.md         # 当前进度快照
log.md              # 只追加：## [YYYY-MM-DD] op | title
```

```text
# 闭环骨架：同一套 goal → act → check → fix → repeat，换皮即可复用
# 编码循环
读 VISION.md + ARCHITECTURE.md → 规划下一步改动 → 改代码 → 跑测试
  ├ 失败：读报错 → 修 → 再测
  └ 通过：总结改动 → 停
# 内容循环
定题/受众/目标 → 起草 → critique agent 评审 → 按意见重写
  → 对照成功标准打分 → 过则发布 / 不过则再写
# 研究循环
定研究问题 → 检索来源 → 摘要 → 对照来源核实 → 比对冲突信息
  → 综合答案 → 置信度达阈值即停
```

```json
// 护栏：无人值守循环 = 无人值守攻击面，deny + hook 不是可选项
{
  "permissions": {
    "allow": ["Read(*)", "Bash(npm run test *)"],
    "deny":  ["Bash(git push origin main)", "Bash(rm *)", "Edit(.env)"]
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "./.claude/hooks/block-dangerous.sh" } ] }
    ]
  }
}
```

## 权衡与反模式

循环安静死掉的三种方式（务必各配一道解法）：

- **Ralph Wiggum 循环**：把半成品当完成，因为「done」是 agent 的意见而非测试。解法：能真正 fail 工作的硬门（契约 + 独立 grader）。
- **目标漂移**：长跑中原始约束慢慢淡掉，「别碰 billing」在第 47 轮消失。解法：每轮重读的常驻 spec/契约。
- **理解债（comprehension debt）**：循环越快写出你没写的代码，仓库与你理解之间的鸿沟越大。解法：读 diff、限制在小改动、绝不让它碰架构。

其余高频反模式：

- **角色混用 → 谄媚收敛**：同一 agent 既写又评，永远给自己打 A。三角色、三上下文，evaluator 默认「代码是坏的」。
- **打断重启**：误把模型「扔掉重来」当成出错而中止，反而毁掉循环最有价值的行为。只在契约错时插手，build 坏不插手。
- **凭 vibe 调参**：不读 trace 只重跑实验，永远找不到判断分歧的那一刻。
- **单调增长的 harness**：每代模型免费能做的事越来越多，harness 却只增不减，最终变成你不再读、却仍在约束新模型的死重。
- **过早开环**：check 还不够强就放开探索，开环会试太多路径、快速产出低质内容、漂离真实目标且难以控制。先闭环、后开环。
- **忽视 token 经济**：循环天然烧 token（fleet 可达每周数百万），在按量计费且无廉价长上下文模型时，循环只会停留在「昂贵实验」而非「可日常运行的工作流」。
- **其他烧钱坑**：跳过四条件测试；让第二个 agent「review」却没有测试（只是第二个乐观主义者）；没有状态文件；没有硬停（跑到你看见账单为止）；无人值守却开宽权限；每轮都用顶级模型。
- **何时不该建**：一次性任务、判断型工作、无自动验收、预算紧张时，单发精准 prompt 仍然更优。

## 参考

- LOOPS.md: Field Notes on Agents That Run for Days — Andrej Karpathy（loops.md, v060726，长跑 agent 循环工作笔记）
- [Loop Engineering: How to Build AI Agent Loops That Run Themselves](https://www.requesty.ai/blog/loop-engineering-how-to-build-ai-agent-loops-that-run-themselves) — Requesty, 2026
- [Build Autonomous Agents with Claude Code /goal + Routines](https://www.sabrina.dev/p/loop-engineering-claude-code-goal-routines) — Sabrina Ramonov
- [Autonomous Long-Running Coding Agents](https://academy.dair.ai/blog/autonomous-long-running-coding-agents) — DAIR.AI
- [Loop Engineering: A Crash Course](https://agentfactory.panaversity.org/docs/loop-engineering-crash-course) — Panaversity Agent Factory
- [What Is Loop Engineering? AI Feedback Loops](https://kilo.ai/articles/what-is-loop-engineering) — Kilo
