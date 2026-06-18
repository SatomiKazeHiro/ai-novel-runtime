# Refresh `docs/ISSUES.md` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把过期的 `docs/ISSUES.md`(2026-06-16 快照)刷成"已修状态标注 + 解耦候选库选型"的当前真实状态,1 个 commit 完成。

**Architecture:** 单文档重写(非 mv)。`docs/ISSUES.md` 全文替换;**不动任何代码**。结构按 spec §「设计」节 1 落地,状态字段格式按 spec §「设计」节 2,库选型 4 子节按 spec §「设计」节 3。

**Tech Stack:** N/A(纯 markdown)。

---

## 前置知识(必读)

- **Spec(本计划的输入)**:`docs/superpowers/specs/2026-06-17-refresh-issues-doc-design.md`
  - §「设计」节 1 = 文档结构
  - §「设计」节 2 = 状态字段规范 `[RESOLVED yyyy-mm-dd by <hash>]`
  - §「设计」节 3 = 库选型 4 子节(3.1 zod / 3.2 token / 3.3 shared type / 3.4 DI)
  - §「设计」节 4 = 守门(0 新库 / 复用 1 / 拒 12)
- **当前文件**:`docs/ISSUES.md`(137 行,2026-06-16 写的过期快照)
- **commit hash 校对**:`docs/superpowers/specs/2026-06-17-refresh-issues-doc-design.md` 的「背景」节里 Q1 / Q6 的 commit hash 标了"需补"——Task 1 Step 2 会跑 git log 补完。
- **不要做的事**:
  - 不动任何 `apps/server` / `apps/web` / `packages/*` 代码
  - 不实现任何库选型结论(spec §「设计」节 3 只**记录**,不实施)
  - 不动 `KNOWN-ISSUES.md`、`docs/LOGIC.md`、`docs/QUESTIONS.md`(它们是独立清单)
  - 不删原文,只**追加状态行**(spec §「设计」节 2 明确"原文一字不删")
  - 不在 commit 信息里堆 emoji

---

## Task 1: 刷新 `docs/ISSUES.md`

**Files:**
- Modify: `docs/ISSUES.md`(全文重写,文件路径不变)

- [ ] **Step 1: 读 spec + 读当前 ISSUES.md,理清新旧映射**

读两个文件(Read tool,顺序无关):
1. `docs/superpowers/specs/2026-06-17-refresh-issues-doc-design.md` — 重点看「设计」节 1 / 2 / 3 / 4 + 「用户决策记录」节 D1-D4
2. `docs/ISSUES.md` — 重点看 7 条 P0(行 10-77)+ 10 条 Q 决策表(行 109-125)

在脑里(或临时 note)列个映射表:P0/Q 编号 → spec「背景」节给的 commit hash 校对结果(下一步会跑 git log 拿到最终值)。

- [ ] **Step 2: 跑 git log 校 commit hash,补完 spec 里的"需补"项**

跑以下命令,把输出**完整贴回 plan / 或写到临时 note**,不要只看不存:

```bash
git log --oneline --all | head -60
```

从输出里**逐条**确认下表(对照 spec「背景」节,缺什么补什么):

| 条目 | spec 已给 hash | git log 验证结果(填本栏) |
|---|---|---|
| P0 #1 user-edited | c98d582 | (verify) |
| P0 #2 8000 字截断 | e077407 | (verify) |
| P0 #3 useChapterEditor JSON.parse | dba2ba1 | (verify) |
| P0 #4 routes/graph.ts:18 JSON.parse | dba2ba1 | (verify) |
| P0 #5 prepare-archive try/catch | 09092ae | (verify) |
| P0 #6 ai-provider apiKey 泄漏(GET) | 092cc08 | (verify) |
| P0 #6 补全(写路径) | 8b5565c | (verify) |
| P0 #7 select 跨章改 draft | 116247c | (verify) |
| Q1 enum 同步 + PendingArchiveData 共享 | 需补 | **应为 d2034a6**(`refactor(shared): align ChapterStatus enum + share PendingArchiveData`) |
| Q3 assertStatus dead code | f0bb424 | (verify) |
| Q3 收尾(死代码 II) | 6528301 | (verify) |
| Q5 safeJsonParse 统一 | dba2ba1 | (verify) |
| Q6 PendingArchiveData 共享 | 已被 d2034a6 覆盖(Q1 hash 同时管 Q6) | (verify) |
| Q7 prepare-archive try/catch | 09092ae | (verify) |
| Q8 select chapterId 校验 | 116247c | (verify) |
| Q9 zod 接入 | 47e0d2c + 8ce9eaa(spec 误标 OPEN,实际已修) | **47e0d2c 主 + 8ce9eaa 补 whitespace 校验** |
| Q10 状态机锁 | 510a656 + 5f80270 | (verify) |
| Bonus cytoscape null | 4def263 | (verify) |

**Q9 状态调整**:Q9 实际**已修**(commit `47e0d2c` + `8ce9eaa`),spec 误标 OPEN。Step 4 写新 ISSUES.md 时,要把 Q9 移到"[Q 决策 - 已修]"组,标 `[RESOLVED 2026-06-16 by 47e0d2c, 8ce9eaa]`。在 commit message body 里**提一下** spec 的这个修正(便于审计)。

- [ ] **Step 3: 构造"修复时间线"数据**

跑以下命令,把输出**完整贴回**:

```bash
git log --oneline --all --since="2026-06-15" --pretty=format:"%h %ad %s" --date=short
```

输出的每一行会成为新 ISSUES.md 末尾"## 修复时间线"表的一行,按日期降序即可(已经是)。**只用这个时间窗内、且与 P0/Q/bonus fix 相关的 commit**;其它(纯 docs / 重构 / perf 优化)不进表。

- [ ] **Step 4: 写新 `docs/ISSUES.md`**

用 Write tool **全文重写** `docs/ISSUES.md`。结构严格按 spec §「设计」节 1:

```
# P0 Issues (标题保留,顶部加修订说明)
> 修订说明: 本文件最后刷新 2026-06-17,基于 spec 2026-06-17-refresh-issues-doc-design.md (commit 07dbcc5)。
> 历史 7 条 P0 全部 RESOLVED,只剩 1 条 NEW 高优项(重复依赖 + 三套 token 实现)。
> 库选型 4 子节已定稿,新引入库 = 0。

## [P0 已修] (7 条,每条原文保留 + 末行加 [RESOLVED yyyy-mm-dd by <hash>])
- 把原行 10-77 的 7 条按 spec「背景」节表搬到此处
- 每条 File:line / Symptom / Repro / Root cause / Blast radius 全部**一字不删**
- 每条末追加一行: `**Status:** [RESOLVED yyyy-mm-dd by <hash>]` (7-char short hash)

## [P0 待办] (1 条:NEW 重复依赖 + 三套 token 实现)
- [NEW 2026-06-17]
- File:line 列: package.json × 7 (root + apps/server + apps/web + 4 packages)
- File:line 列: packages/prompt-runtime/src/index.ts (PromptAssembler.budget)
- File:line 列: apps/server/src/services/combined-extractor.ts (computeContentCharBudget, 2026-06-17 引入)
- Symptom: 事实上的"三套 token 实现"—— 详见 spec「背景」节新发现段
- Root cause: 各 service 各自 import 各自的 js-tiktoken,无单一 source of truth
- Blast radius: token 预算不一致 → 长章节可能 1) 被错算成"够"实际不够 2) 被错算成"不够"实际够
- 修复方向: 集中到 packages/ai-provider 一处,其它包 transitive 依赖 (见「解耦候选库」3.2)
- **Status:** [OPEN]

## [Q 决策 - 已修] (Q1/Q3/Q5/Q6/Q7/Q8/Q9/Q10,8 条)
- 用表格,沿用原文档「用户决策记录」节的格式(议题 / 用户决策 / 后续方向 / [Status])
- Q9 移到此处(SPEC 修正)
- 「后续方向」列保留原 ISSUES.md 的内容不变

## [Q 决策 - OPEN] (无,SPEC 修正后 0 条)
- 显式标 "无" + 一句话说明 "Q9 实际已修,见 [Q 决策 - 已修]"

## [Bug fix 备忘] (cytoscape null - 4def263)
- File:line: apps/web/src/views/Graph.vue:146, 253-264, 283, 773
- Symptom: 准备归档后,鼠标 hover 知识图谱触发 cytoscape.esm.mjs:20003 TypeError: Cannot read properties of null (reading 'isHeadless')
- Root cause: 缺 onBeforeUnmount,cy 实例在 unmount 后未清理
- Fix: 加 onBeforeUnmount + removeAllListeners() + destroy() + cy = null
- **Status:** [RESOLVED 2026-06-17 by 4def263]

## [解耦候选库] (4 个子节)
### 3.1 Schema / 运行时校验 — zod ✅ 推荐
(原文搬 spec §3.1,含候选表、推荐、拒了的、应用范围)

### 3.2 Token counting 统一 — 不引入新库,自建单例
(原文搬 spec §3.2)

### 3.3 跨包类型共享 / API contract — 不引入新库,继续推 packages/shared
(原文搬 spec §3.3)

### 3.4 服务分层 / DI — 不引入 DI 容器,继续 Fastify plugin 模式
(原文搬 spec §3.4)

## 「库数量」守门
(原文搬 spec §4 表格)

## 修复时间线
(从 Step 3 git log 输出挑相关 commit,按日期降序,3 列表:日期 / hash / 说明)
```

**注意**:
- spec 是设计意图源,本 step 是把 spec 实施成最终 markdown。如果 spec 里有"待补"且 git log 给出了值,就用 git log 值(spec 是设计时拍板,git log 是事实,事实优先)
- Q9 状态修正要在新文件里明确体现(用「SPEC 修正」字样标注,留审计线索)
- markdown 表格列宽不必对齐 github 渲染,但每列用 `|` 分隔清楚
- 7-char short hash 例:`c98d582` 即可,不用全 hash
- 「修复时间线」只列与 P0/Q/bonus 修复**直接相关**的 commit,不要把 docs / 重构 / perf 优化也塞进去

- [ ] **Step 5: diff 自检 — 确认没漏 spec 节点、没动其他文件**

```bash
git status
```

**预期输出**:
```
On branch main
Changes not staged for commit:
  modified:   docs/ISSUES.md
```

(只有 ISSUES.md 一处 modified,没有 untracked,没有其它 modified)

如果出现其它文件,立刻 `git restore <file>` 撤回(详见 `memory/feedback-commit-scope-discipline.md`—— commit 前必须 status 确认范围)。

再跑:

```bash
git diff --stat docs/ISSUES.md
```

**预期**:1 file changed,约 137 → ~250 行(可 ±20 行)。

逐项核对:
- [ ] 7 条 P0 全部移到 [P0 已修],每条末有 `[RESOLVED yyyy-mm-dd by <hash>]`
- [ ] [P0 待办] 1 条(重复依赖 + 三套 token 实现)
- [ ] [Q 决策 - 已修] 8 条(Q1/Q3/Q5/Q6/Q7/Q8/Q9/Q10)
- [ ] [Q 决策 - OPEN] 显式标"无"+ SPEC 修正说明
- [ ] [Bug fix 备忘] 1 条(cytoscape null)
- [ ] [解耦候选库] 4 个子节(3.1/3.2/3.3/3.4)
- [ ] 「库数量」守门表
- [ ] 修复时间线表

- [ ] **Step 6: 校验 markdown 不破**

跑 typecheck(不依赖 ISSUES.md,但要确保环境干净):

```bash
pnpm typecheck 2>&1 | tail -15
```

**预期**:8 个 workspace 都 "Done",无 error。(ISSUES.md 是 markdown,不影响 tsc,但跑一下确认没意外环境问题。)

- [ ] **Step 7: commit**

**先跑** `git status` 再 add(详见 memory/feedback-commit-scope-discipline.md):

```bash
git status
```

**预期**:只有 `docs/ISSUES.md` modified。

确认范围干净后:

```bash
git add docs/ISSUES.md
git commit -m "$(cat <<'EOF'
docs(issues): refresh status — all 7 P0 RESOLVED, add decoupling library section

按 docs/superpowers/specs/2026-06-17-refresh-issues-doc-design.md (commit 07dbcc5)
实施刷新:

[P0 已修] 7 条全部 RESOLVED,标 [RESOLVED yyyy-mm-dd by <hash>]
[P0 待办] 1 条 NEW 高优项(重复依赖 + 三套 token 实现)
[Q 决策 - 已修] 8 条(Q1/Q3/Q5/Q6/Q7/Q8/Q9/Q10)
[Q 决策 - OPEN] 无(SPEC 修正:Q9 实际已修,见 commit 47e0d2c + 8ce9eaa)
[Bug fix 备忘] cytoscape null (4def263)

[解耦候选库] 4 子节定稿:zod(推荐)/ token counting(集中到 ai-provider)/
shared type(继续推 packages/shared)/ DI(继续 Fastify plugin)

守门:新引入库 = 0,复用 1 (zod),调研 12 候选全部拒掉。
原则:"通用 + 解耦 + 易读 + 扩展性,宁少勿滥"。

SPEC 修正:Q9 在 spec「背景」节里误标 OPEN,实施时经 git log 校对确认
实际已修(47e0d2c + 8ce9eaa),已在 [Q 决策 - 已修] 体现。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**commit 后跑** `git log --oneline -1` 确认:
- hash 是新 commit
- 标题第一行 ≤ 70 字符
- body 含 SPEC 修正说明

---

## Self-Review

**1. Spec coverage:**
- ✅ spec §「设计」节 1 文档结构 → Step 4 写入新 ISSUES.md
- ✅ spec §「设计」节 2 状态字段 → Step 4 末行追加 + Step 1-2 校对
- ✅ spec §「设计」节 3 库选型 4 子节 → Step 4 末尾搬入
- ✅ spec §「设计」节 4 守门 → Step 4 「库数量」守门小节
- ✅ spec「背景」节 commit hash 校对 → Step 2(把 spec 的"需补"项补完)
- ✅ spec「范围」节 In/Out → 全文限定 docs/ISSUES.md,代码不动

**2. Placeholder scan:**
- 无 "TBD" / "TODO" / "待补" / "fill in" / "implement later"
- Step 4 把"原文搬 spec §3.x"作为占位语,属**执行指令**(子 agent 知道从哪个文件读),不是"未填"占位——可接受

**3. Type consistency:**
- 状态字段格式 `[RESOLVED yyyy-mm-dd by <hash>]` 在所有 P0/Q/bonus fix 末统一
- 短 hash 7 字符统一
- section 标题 `## [...]` 前缀统一

**4. Scope check:**
- 单 task、单文件、1 commit,符合 spec「范围」节
- 无代码改动,无依赖变更,无跨模块影响

**5. Ambiguity check:**
- Step 2 明确说"事实优先"——若 spec 标错,以 git log 为准
- Step 5 明确说"如果出现其它文件,立刻 git restore 撤回"
- Step 7 commit message 显式提 SPEC 修正,留审计线索

---

## 关键风险

- **Q9 状态修正**:spec 误标 OPEN,实施时必须按 git log 改。这已在 Step 2 + commit message 双重保险。
- **commit scope 走样**:CLAUDE.md 强调 commit 前 git status 确认范围,Step 5 + Step 7 各跑一次,双保险。
- **markdown 渲染**:不需要 build 验证,github 渲染即可,人工 review 阶段确认。
