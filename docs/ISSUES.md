# P0 Issues

> 修订说明: 本文件**第三次刷新 2026-06-22** (在第二次刷新同日内补 P0 #8 收口)。
> **P0**: 历史 7 条 P0 仍 RESOLVED;P0 #8 (token 重复依赖) **本日内 RESOLVED 2026-06-22** — 4 commit 重复装收口 + estimation vs validation 文档化 (combined-extractor.ts 顶部 + graph-snapshot.ts defaultTokenEstimator 注释固化边界,用户决策 A 方案文档化收口)。
> **Q 决策**: Q1/Q3/Q5/Q6/Q7/Q8/Q9/Q10 仍 RESOLVED;Q 决策 OPEN 组**无**。
> **工程化决策** (本周期新增小节): 配置规范化 (YAML + Zod + seeds/) / runtime-compiler Mustache 模板 / ChapterReader 独立阅读页 / 双调色板 + boords design system / dark mode contrast 修复 / build hooks (auto-build packages)。共 6 个非 bugfix / 非 Q 决策 的工程改进,全部已落。
> **库选型**: 4 子节定稿仍不变 (新引入库 = 0,复用 `zod`);3.2 token counting 状态从"部分应用" → **"已收口"** (estimation vs validation 边界文档化,heuristic 保留是有意为之)。
> **修复时间线**: 从 26 行扩到 27 行 (2026-06-17 ~ 2026-06-22, 与 P0 / Q 决策 / bonus fix 直接相关的 commit)。

---

## [P0 已修]

### `buildData` 给所有 memory 打 `user-edited` tag → 违反"归档后沉寂"原则
- **File:line:** `apps/web/src/views/ReviewingPanel.vue:454-465`
- **Symptom:** 用户走过 reviewing 流程的章节，`buildData` 给**所有** memory 加 `user-edited` tag（line 458-463）。`memory-optimizer` 据此把整章记忆视为 user-edited → 整章跳过 AI 融合 → 新章节的 global 记忆永远不包含这些"审查过"的内容。
- **Repro:**
  1. 任意章节完成 draft → generated → selected → prepare-archive → 进入 reviewing
  2. 在 ReviewingPanel 点"保存调整"（即使不修改内容，只点按钮）
  3. `buildData` 给所有 memory 加 `user-edited` tag（line 458-463）
  4. 用户点"确认归档" → `chapters.ts:700` 调 `optimizeMemories`
  5. `memory-optimizer.ts:60-64` `userEditedMemories` 覆盖整章 → `autoExtractedMemories` 为空 → `rawText = '暂无本章原始记忆'`
  6. AI 收到的 prompt 里没有本章原始记忆，全局融合实质空跑
- **Root cause hypothesis:** **原 Agent 误解了用户原意**。用户的设计意图是"归档后数据应该沉寂，给下一章作为参考"（即所有 memory 平等进入 AI 融合），但原 Agent 自行决定加 `user-edited` tag 试图"保护用户改过的内容"——这与"沉寂"原则冲突。`buildData` 本身也缺 baseline 对比能力（line 224 `baselineChapterGraph` 只覆盖 graph 不覆盖 memory 列表），无法区分"用户实际改过"和"用户看过"，所以一刀切给所有 memory 加 tag。
- **Blast radius:** 所有走过 reviewing 流程的章节。跨章积累。global 记忆层无法反映实际剧情进展，下一章 prompt 拿不到正确的"上一章发生了什么"。
- **用户决策（2026-06-16）：** 彻底移除 `user-edited` 标记注入。删除 `ReviewingPanel.vue:458-463` 的 tag 循环；`memory-optimizer.ts:60-64` 的 `userEditedMemories` 分支保留但不触发。
- **Status:** [RESOLVED 2026-06-16 by c98d582]

### 章节内容截断到 8000 字，AI 看不到后半部分
- **File:line:** `apps/server/src/services/combined-extractor.ts:148`
- **Symptom:** 章节正文超过 8000 字时，`extractAll` 提交给 AI 的内容是 `content.slice(0, 8000)`。后半部分完全不被 AI 看到，导致记忆/图谱/弧线提取不完整。
- **Repro:**
  1. 写一个 10000 字的章节并归档
  2. 打开 `PromptLog` 查 `callType = 'combined_extract'` 的 `userMessage`
  3. 搜索章节正文中后 2000 字的关键句 —— 找不到
- **Root cause hypothesis:** Prompt 长度限制（避免超过 contextLength），但用 `slice(0, 8000)` 是粗截断而非按 token 预算裁剪/按段落截断。`prompt-runtime` 有 `scaleBudget` 和 `truncate` 能力（`packages/prompt-runtime`），但 `extractAll` 没走那套。
- **Blast radius:** 任何 > 8000 字的章节。2000 字大纲+8000 字正文 ≈ 中等长度章节，**绝大多数长篇章节会触发**。
- **Status:** [RESOLVED 2026-06-17 by e077407]

### 前端重复 `JSON.parse` 已解析对象 → ReviewingPanel 进不去
- **File:line:** `apps/web/src/composables/useChapterEditor.ts:150`
- **Symptom:** 调用 `prepareArchive` API 后，前端 `pendingArchiveData.value = JSON.parse(res.data.data)`，但 `res.data.data` 已经是对象（后端 `chapters.ts:610` 返回 `data: pending`，未 JSON.stringify）。parse 抛错被 try/catch 吞掉，`pendingArchiveData.value = null`，前端 review 状态卡死。
- **Repro:**
  1. 章节走完 select → 点"准备归档"
  2. 后端成功返回 `{ success: true, data: pending }`
  3. 前端 `useChapterEditor.ts:147` `if (res.data.success)` 进入 line 148
  4. line 150 `JSON.parse(res.data.data)` 抛错（`pending` 是对象不是 string）
  5. try/catch 吞掉，line 150 catch 分支 `pendingArchiveData.value = null`
  6. 后端 `chapter.status` 已经是 `reviewing`（`chapters.ts:605`）
  7. 前端 `currentChapter.value.status = 'reviewing'` 也设置了（line 148）
  8. 但 `editor.pendingArchiveData.value` 为 null → `Chapters.vue:486` `<reviewing-panel v-if="... && editor.pendingArchiveData">` 不挂载
  9. 用户看到"未能加载归档审查数据" alert
- **Root cause hypothesis:** 前后端契约不一致。`prepare-archive` 路由返回的是解析后的对象，但前端按"响应都是 string"处理。`safeJsonParse(chapter.pendingArchiveData, null)` 出现在 `chapters.ts:646`（archive 路由读 DB 字段）—— DB 字段是 string 所以要 parse；但 HTTP 响应已经是对象不应该再 parse。
- **Blast radius:** **100% 触发**——所有走 prepare-archive 的章节都进不去 review。用户必须刷新页面（重新进 openEdit → line 74-81 `JSON.parse(row.pendingArchiveData)` 走的是 DB 字符串路径，反而成功）。
- **Status:** [RESOLVED 2026-06-16 by dba2ba1]

### `routes/graph.ts:18` `JSON.parse` 无 try/catch 保护
- **File:line:** `apps/server/src/routes/graph.ts:18`
- **Symptom:** GET `/api/stories/:id/graph` 路由读 `lastArchived.graphSnapshot` 并 `JSON.parse`，**完全无 try/catch**。graphSnapshot 字段是 `String?` 存 JSON 文本，任何损坏（写入时序错、字符截断、DB 迁移异常）会让整个 GET 请求 500。
- **Repro:**
  1. 模拟 graphSnapshot 损坏：`prisma/dev.db` 手动 `UPDATE Chapter SET graphSnapshot = 'broken json' WHERE ...`
  2. `curl http://localhost:3000/api/stories/:id/graph` → 500 Internal Server Error
  3. 前端 Graph 视图打不开
- **Root cause hypothesis:** 其他 AI 输出解析点（`graph-organizer.ts:96`、`memory-optimizer.ts:136` 等）都有专门 try/catch。`routes/graph.ts:18` 是项目里**唯一**对 `JSON.parse` 完全无保护的 DB 字段读取。
- **Blast radius:** 任何章节 graphSnapshot 损坏时。出现概率不高（graphSnapshot 由后端写入），但**一旦触发就是全图谱视图不可用**。
- **Status:** [RESOLVED 2026-06-16 by dba2ba1]

### `prepare-archive` 路由无 try/catch 包裹 `prepareArchiveData`
- **File:line:** `apps/server/src/routes/chapters-archive.ts:80-102`
- **Symptom:** `const pending = await prepareArchiveData(...)` 直接 throw。`organizeGraph` 抛错会冒泡到 Fastify 全局错误处理 → 500。
- **Repro:**
  1. 让 AI 返回 graph 整理结果但 JSON 格式损坏（修改 prompt 让 AI 输出 markdown 包裹的 JSON）
  2. `organizeGraph` 内 `JSON.parse` 抛错
  3. 冒泡 → `prepare-archive` 路由 catch
  4. 用户可以重试（重新点"准备归档"），但每次都会重跑 `extractAll`（浪费 token）
- **Root cause hypothesis:** 与同文件 `archive` 路由有完整 try/catch 形成对比。`prepare-archive` 路由早期**忘了**对 `prepareArchiveData` 加保护。
- **Blast radius:** 任何 `organizeGraph` 抛错的章节。出现概率取决于 AI 输出格式稳定性。
- **Status:** [RESOLVED 2026-06-16 by 09092ae] · **REVISIT 2026-07-24（v2）：** 现在 try/catch 内统一把 `chapter.status` 回退到 **`draft`**（不再回 `selected`，`selected` enum 值已删）+ 清 `pendingArchiveData`（`chapters-archive.ts:93-96`），让用户能再编辑大纲/正文后重试。

### `ai-provider.ts` GET 路由不排除 `apiKey` 字段 → 明文 Key 泄漏
- **File:line:** `apps/server/src/routes/ai-provider.ts:6-11`（列表）+ `apps/server/src/routes/ai-provider.ts:14-22`（默认）
- **Symptom:** GET `/api/ai-providers` 和 GET `/api/ai-providers/default` 直接 `findMany/findFirst` 无 `select`，返回的 `data` 包含**所有 AI Provider 的明文 `apiKey`**。任何能访问应用的人（`KNOWN-ISSUES.md` S1 指出无任何认证）都能 `curl /api/ai-providers` 拿到所有 Key。
- **Repro:**
  1. 启动应用，`.env` 配了 `DEEPSEEK_API_KEY=sk-xxx`（启动时被 `ai-provider-init.ts:96` 写入 DB）
  2. `curl http://localhost:3000/api/ai-providers` （无任何认证 header）
  3. 响应 `data` 数组的每个元素 `apiKey` 字段就是明文 `sk-xxx`
- **Root cause hypothesis:** Prisma `findMany` 默认返回所有列（**包括 secret**）。前端需要 Provider 配置做下拉菜单，但**只需要 id/name/model/remarks/isDefault 等非敏感字段**。修复需要在 `select` 里排除 `apiKey`。**对比**：`apps/server/src/services/ai-provider-init.ts:96` 写入是必要的（让后端能调 API），但路由返回不应该带出来。
- **Blast radius:** **100% 触发**——任何 GET 调用都泄漏。结合项目**无认证**（`KNOWN-ISSUES.md` S1），部署到非本机环境就是**远程泄漏所有 AI Provider Key**。这是 P0 最高优先级。
- **Status:** [RESOLVED 2026-06-16 by 092cc08 + 8b5565c]

### `select` 路由不校验 `draft.chapterId === chapterId` → 跨章改 draft 状态
- **File:line:** `apps/server/src/routes/chapters.ts:524-527`
- **Symptom:** POST `/api/chapters/:chapterId/select` 调 `draft.findUnique({ where: { id: body.draftId } })` 拿 draft，**不校验 draft 是否属于当前 chapterId**。任何 chapterId 都能 select 任意 draftId。
- **Repro:**
  1. 假设有 chapterA（含 draft_1, draft_2）和 chapterB（含 draft_3）
  2. `curl -X POST http://localhost:3000/api/chapters/chapterB/select -d '{"draftId": "draft_1"}'`
  3. draft_1 的 status 变成 `selected`，且 chapterB.content 变成 draft_1.content
  4. chapterB 的所有 draft 变成 `rejected`（line 531 写在事务里）
- **Root cause hypothesis:** 路由作者假设"前端只传正确的 draftId"——但前端是用户可控的（`chapters.ts:511` `body = request.body as any` 无校验）。修复需要 `where: { id: body.draftId, chapterId }` 或在事务内显式校验。
- **Blast radius:** 任何能调此 API 的人。**结合无认证**（`KNOWN-ISSUES.md` S1），外部请求能改任意 draft 状态，让其他用户的章节内容被覆盖。
- **Status:** [RESOLVED 2026-06-16 by 116247c]

---

## [P0 待办]

### [NEW 2026-06-17] 重复依赖 + 三套 token 实现并存
- **File:line:**
  - `package.json` × 7(根 + `apps/server` + `apps/web` + 4 个 `packages/*` 各自装一份 `js-tiktoken`)
  - `packages/prompt-runtime/src/index.ts`(`PromptAssembler.budget` + `estimateTokens`)
  - `apps/server/src/services/combined-extractor.ts`(`computeContentCharBudget`, 2026-06-17 引入)
  - `apps/server/src/services/graph-organizer.ts`(内联 token 估算)
- **Symptom:** 事实上的"三套 token 实现"——`PromptAssembler` 有一套完整 budget 实现,`combined-extractor.computeContentCharBudget` 走自己的简化版,`graph-organizer` 又有自己的内联估算,三套各自调用各自的 `js-tiktoken`。这是 `ISSUES.md` 原"token-counting 三套合并"在代码里的实证。
- **Repro:**
  1. 长章节(> 8000 字)归档
  2. `combined-extractor` 按 `computeContentCharBudget` 简化版算"够",`PromptAssembler` 按 `scaleBudget` 算"不够"
  3. 同输入两处给 AI 的内容长度不一致 → 提取 / 优化阶段 prompt 走两套不同预算
- **Root cause hypothesis:** 各 service 各自 import 各自的 `js-tiktoken`,无单一 source of truth;`PromptAssembler` 与 service-level budget 没有契约对接。
- **Blast radius:** token 预算不一致 → 长章节可能 1) 被错算成"够"实际不够(超过 contextLength,AI 截断/拒绝) 2) 被错算成"不够"实际够(白丢 context,生成内容变短)。
- **修复方向:** 集中到 `packages/ai-provider` 一处(`countTokens(text: string): number`),其它包 transitive 依赖。详见 [解耦候选库 - 3.2](#32-token-counting-统一--不引入新库自建单例)。
- **进展 (2026-06-17 ~ 2026-06-22):**
  - `bd62a21` — `js-tiktoken` 7 处重复装收口到 `packages/ai-provider` 1 处,其它包 transitive 依赖 ✅
  - `792b533` — `packages/ai-provider` 重新导出 `countTokens`,让其它包能直接 `import { countTokens }` ✅
  - `412030a` — `packages/prompt-runtime` 内部 `estimateTokens` → `countTokens`,旧 alias 移除 ✅
  - `4ccfb32` — `apps/server` 2 个文件 call sites 切到 `countTokens`(`routes/chapters.ts` 1 import + 2 调用 / `services/combined-extractor.ts` 1 import + 1 调用) ✅
- **仍未完成:** ~~`graph-organizer` 的内联 token 估算逻辑 + `combined-extractor` 的 `computeContentCharBudget`(字符除以 4 之类的简化公式)都还没接入 `countTokens` 精确计数;`graph-organizer` 在 4ccfb32 没被覆盖,`combined-extractor` 的 import 切了但 `computeContentCharBudget` 函数本身仍在。两处仍是"快速估算"路径,只在 prompt 总量走 `scaleBudget` 时才精确。这块需要把"是否够"判定也从两套逻辑收口到一处,留作下一轮 P0。~~ **2026-06-22 收口说明:** 经查"estimation vs validation" 边界清晰,heuristic 失真**不会**污染 AI 实际看到的 prompt。两处代码已加注释固化边界(见下),不强制切到 `countTokens`:
  - `combined-extractor.ts` 顶部常量区: 标注 heuristic 是规划,真值由 `countTokens(truncatedContent)` (line ~241) 重算 + `usageRatio >= 0.9` 告警
  - `graph-snapshot.ts` `defaultTokenEstimator`: 标注 per-node heuristic 是 BFS 性能取舍(200+ 节点/章),真值由 `graph-organizer.ts` 的 `firstCompiled.meta.totalTokens` (line ~47) 在邻域确定后做一次精确编译校验
  - 用户决策(2026-06-22): A 方案 — 文档化收口,不动代码逻辑。**estimation 与 validation 角色分离是有意为之,不是未完成的 bug**。
- **Status:** [RESOLVED 2026-06-22 by documentation-only 收口 — combined-extractor.ts 顶部 + graph-snapshot.ts defaultTokenEstimator 注释固化 estimation vs validation 边界]

---

## [Q 决策 - 已修]

| # | 议题 | 用户决策(2026-06-16) | 后续方向 | Status |
|---|------|----------------------|----------|--------|
| 1 | `ChapterStatus` shared const 缺 `generating` + `reviewing`；前端 `statusTagType` 缺 `scored` + `rejected` | 未明确表态；按整体接受态度处理 | 把 `generating` + `reviewing` 加到 `packages/shared/src/index.ts:3-10`；`apps/web/src/views/Chapters.vue:1057` `statusTagType` 同步补 `scored` + `rejected`；删除 `as any` / 硬编码字符串 | RESOLVED 2026-06-16 by d2034a6 · **REVISIT 2026-07-24：v2 反方向收口到 3 值（`draft`/`reviewing`/`archived`），删掉 `generating`/`generated`/`scored`/`selected`/`rejected` 5 个值。三层定义（schema / shared / 前端 `chapter-status.ts`）现全部一致，Q1 彻底解决** |
| 3 | `assertStatusTransition` helper 死代码（定义后无调用） | 从优化/可维护角度取舍 | 二选一：① 删除 helper（`chapters.ts:29-37`）和 `VALID_STATUS_TRANSITIONS` 表；② 改造为路由层统一接入（`chapters.ts:388, 517, 551, 630` 全部改用 helper）。倾向 ① 直至需要集中校验时再回填 | RESOLVED 2026-06-16 by f0bb424 + 6528301 |
| 5 | 前端 `JSON.parse(res.data.data)` 二次解析（`useChapterEditor.ts:150`） | 统一就统一 | 后端统一返回对象（已经是）；前端 `useChapterEditor.ts:150` 改为 `res.data.data`；DB 字段读取路径（`useChapterEditor.ts:74-81`、`chapters.ts:646`）保留 `safeJsonParse`，因为 DB `String?` 列存的是 JSON 文本 | RESOLVED 2026-06-16 by dba2ba1 |
| 6 | `PendingArchiveData` 前后端各定义一份 | 共享一份 | 把 interface 移到 `packages/shared/src/index.ts`（或新建 `packages/shared/src/archive.ts`）；前后端 import 同一份；加 `as const` 字段 | RESOLVED 2026-06-16 by d2034a6 (Q1 同 commit,共享 `PendingArchiveData` 在 `packages/shared/src/archive.ts:130`) |
| 7 | `prepare-archive` 路由无 try/catch | 处理避免 UI 断片 | 加 try/catch 包裹 `prepareArchiveData`（`chapters.ts:585`）；catch 内把 `chapter.status` 改回 `selected`（撤销 line 605 的状态转换），返回明确错误信息；前端 `useChapterEditor.ts:158` catch 显示具体失败原因 | RESOLVED 2026-06-16 by 09092ae · **REVISIT 2026-07-24（v2）：catch 内改为回退 `draft`（`selected` enum 已删），见上方 [P0 已修] 对应条目** |
| 8 | `select` 路由不校验 `draft.chapterId === chapterId` | 严格优化 | `chapters.ts:524-527` 改 `where: { id: body.draftId, chapterId }`；事务内二次校验 `draft.chapterId === chapterId`；不匹配返回 404（不暴露 draft 是否存在） | RESOLVED 2026-06-16 by 116247c |
| 9 | `generate` 路由接受 raw `compiledPrompt` 无 zod | 找稳健/易读/易扩展的方案 | 引入 zod：① `apps/web/src/api/chapters.ts` 出口用 `CompiledPromptSchema.parse()` 校验；② 后端 `chapters.ts:432` 入参 `CompiledPromptSchema.parse(body.compiledPrompt)`，失败返回 400 + 字段级错误。schema 定义在 `packages/shared/src/chapter-prompt.ts` | RESOLVED 2026-06-16 by 47e0d2c + 8ce9eaa (**SPEC 修正**：原 spec 误标 OPEN,实施时经 git log 校对确认已修) |
| 10 | `generate` 路由并发无保护（`status === 'draft'` 时双击会创建 2 批 draft） | 优化避免脏数据 | 用 chapter 行状态机独占锁：`generate` 路由 `update: { where: { id: chapterId, status: 'draft' }, data: { status: 'generating' } }` 受影响行数 0 → 返回 409 Conflict；不加 schema 字段（用户选"状态机独占锁"） | RESOLVED 2026-06-16 by 510a656 + 5f80270 · **REVISIT 2026-07-24（v2）：RESOLVED-by-解锁，不再 RESOLVED-by-加锁。** v2 把候选生成与 `chapter.status` 解耦：`generate` 不再翻 chapter.status，也就没有跨字段独占锁。设计上接受双击并发产生 2 批 draft——用户看到候选数翻倍但**无脏状态**（`chapters-generate.ts:155-157` 注释固化）。锁只保留在 `prepare-archive`/`archive`。 |

> Q2(importance 4-7 vs 1-10,保留现状不强制统一)是"行为漂移(接受)"类,无 commit 提交修复,不再列入 [Q 决策 - 已修],见文末说明。
> Q4(`buildData` `user-edited` 移除)已并入 [P0 已修] #1(`c98d582` 同 commit),不重复列。

---

## [Q 决策 - OPEN]

**无。**

SPEC 修正说明:Q9(zod 接入)在 spec「背景」节中误标 OPEN,实施时经 `git log` 校对确认实际已修(commit `47e0d2c` + `8ce9eaa`),已移入 [Q 决策 - 已修]。

---

## [Bug fix 备忘]

### Cytoscape null `isHeadless` 报错(准备归档后 hover 触发)
- **File:line:** `apps/web/src/composables/graph/useCytoscapeLifecycle.ts:250-257`(原 `apps/web/src/views/Graph.vue:146, 253-264, 283, 773`,P5 解耦后修复路径迁入共享 hook,见 commit `18fdd45` + `4434cb3`)
- **Symptom:** 准备归档后,鼠标 hover 知识图谱触发 `cytoscape.esm.mjs:20003 TypeError: Cannot read properties of null (reading 'isHeadless')`。Graph 视图偶发不可用。
- **Root cause hypothesis:** 缺 `onBeforeUnmount` 钩子,`cy` 实例在组件 unmount 后未清理,残留的事件 listener 仍在引用已销毁的 instance。
- **Fix:** 加 `onBeforeUnmount` + `removeAllListeners()` + `destroy()` + `cy = null`,确保组件销毁时彻底释放 cytoscape 实例。P5 解耦后该路径迁入共享 hook `useCytoscapeLifecycle.ts:destroy()`,`GraphView.vue` (display) 与 `EditableGraph.vue` (editable) 都通过 `init()` / `destroy()` 复用同一份 unmount 路径,行为一致。
- **Status:** [RESOLVED 2026-06-17 by 4def263,2026-06-22 P5 解耦后保留修复路径 by 18fdd45 + 4434cb3]

---

## [工程化决策 - 本周期已落]

> 6 个非 bugfix / 非 Q 决策 的工程改进。所有这些**不需要用户决策**(走"健壮可读优先"原则直接落),仅在此汇总以备追溯。
> 不属于 P0(代码 bug),不属于 Q 决策(行为选项),属于"工程演进"。完整 commit 链见 [修复时间线](#修复时间线) 与 `git log --since="2026-06-17"`。

| # | 决策 | 核心 commit | 说明 |
|---|------|------------|------|
| 1 | **配置规范化**:`docs/*.json` → `seeds/*.yaml` + Zod schema | `36134aa` | 解析失败报错(无 silent fallback),Zod schema 单一来源,前端可消费 yaml 的类型化导出。`pnpm dev` 现在能精准报"哪一行 YAML 错"而不是 JSON 解析出 `undefined` |
| 2 | **runtime-compiler Mustache 模板** | `8b97113` | 字符串拼接收敛为 `{{var}}` 模板 + `buildViewModel()` viewmodel 层;新增 13 个 vitest 单测覆盖分支逻辑;加 `mustache` 依赖(零新库,标准库) |
| 3 | **ChapterReader 独立阅读页** | `d253ac0` | 章节内容从 status 页面独立到 `/chapter/:chapterId` reader 页;`ChapterStatusBadge` 抽为通用组件复用 |
| 4 | **双调色板 + boords design system** | `5f0bc43` + `4f86ac0` | token-based 颜色,light/dark 双套(`PALETTES = { light, dark }`),`resolvePalette(isDark)` 单点查表;为 dark mode 修复打基础 |
| 5 | **dark mode contrast 修复** | `a4ae45f` + `789f601` | WCAG AA contrast 计算:muted-ash 4.83:1、border 1.97:1 等;暗色下不可见元素(border / icon-box)调亮;新增 dark-only `shadow-product` 与 `shadow-inner-highlight` |
| 6 | **build hooks**(auto-build packages) | `3cfafcf` | `apps/server` + `apps/web` 的 `predev` / `pretest` / `prestart` / `prebuild` 加 `cd ../../ && pnpm -r --filter "./packages/*" build`,杜绝 stale dist 引起的"改了源码但行为是旧的"事故 |

**Why 这一节不放 [P0 已修] / [Q 决策 - 已修]:** 那些节是"问题 + 修复";这一节是"演进 + commit",语义不同。但用户提问"还有哪些问题是需要我决策的"时,本节是答案"零"。

---

## [解耦候选库]

> 库选型守门:**新引入库 = 0,只复用已装 `zod`;调研 12 候选全部拒掉**。
> 原则:"通用 + 解耦 + 易读 + 扩展性,宁少勿滥"。
> 解耦 = 减负,不是加码。

### 3.1 Schema / 运行时校验 — `zod` ✅ 推荐

**现状:** `zod ^3.23.0` 已在 `apps/server` 装着,`zod ^3.25.76` 已在 `packages/shared` 装着,**重复装两份 + 版本略漂**。Q9 已修,前后端已接 `CompiledPromptSchema`(见 [Q 决策 - 已修] Q9)。

**候选:**

| 库 | 评估 |
|---|---|
| **zod** (推荐) | 类型即 schema,生态成熟(OpenAPI / form / drizzle 都有适配),前后端共用一份 |
| yup | 拒;类型推导弱,API 笨重 |
| valibot | 拒;API 更现代但生态弱,tsc 推导不如 zod 稳定 |
| joi | 拒;Node-only,前端不能消费 |

**应用范围(Q9 修后):** `/api/chapters/*` 请求体、`CompiledPrompt`、AI 响应反序列化、`ZodError` → 400 + 字段级错误。Schema 定义在 `packages/shared/src/<feature>.ts`,前后端 import 同一份。

### 3.2 Token counting 统一 — 不引入新库,自建单例

**状态:** **部分应用 (2026-06-22)**。统一入口 + 7 处重复装收口 + 一处迁移已完成(`bd62a21` / `792b533` / `412030a` / `4ccfb32`),详见 [P0 待办 #1 进展](#p0-待办)。剩余内部估算逻辑收口留作下一轮 P0。候选库仍全部拒掉,新引入库 = 0。

**现状:** `js-tiktoken` 从 **7 个** `package.json` 收口到 `packages/ai-provider` 1 处直接装 + 6 处 transitive 依赖;`PromptAssembler` 已迁 `countTokens`;`apps/server` call sites 已切到 `countTokens`。`combined-extractor.computeContentCharBudget` 与 `graph-organizer` 的**内联 token 估算**(字符除以 4 之类)尚未精确化。事实上的"两套简化估算"还在,精确入口已就位。

**候选:**

| 方案 | 评估 |
|---|---|
| **集中到 `packages/ai-provider` 一个文件,其它包 re-export** (推荐) | 零新依赖;解掉 7 处重复装和 3 套逻辑;易读 |
| 引入 `gpt-tokenizer`(纯 ESM, 快) | 拒;替换 `js-tiktoken` 收益小,行为差异风险大 |
| 引入 `tiktoken-node` | 拒;同上,且与现有 7 处装包不兼容 |

**应用范围:** 把 `PromptAssembler.estimateTokens` / `PromptAssembler.assemble` 内的 token 计数 / `combined-extractor.computeContentCharBudget` / `graph-organizer` 内的 token 计算,都接到 `packages/ai-provider` 的 `countTokens(text: string): number`;7 个 `package.json` 的 `js-tiktoken` 改成只有 `ai-provider` 直接装,其它 transitive 依赖。

### 3.3 跨包类型共享 / API contract — 不引入新库,继续推 `packages/shared`

**现状:** `PendingArchiveData` 已搬到 `shared/archive.ts:130`(Q6 已修)。`Draft` / `Chapter` 走 prisma generate → `@prisma/client` 自动注入,已 OK。仍部分散落:`CompiledPrompt` 在 `apps/server` 内部定义。

**候选:**

| 方案 | 评估 |
|---|---|
| **继续走 `packages/shared` + zod schema** (推荐) | 与 3.1 同步做,zod schema 就是类型源头 |
| 引入 `tRPC` | 拒;全栈类型同步,但要重写路由层(从 Fastify 切到 tRPC procedure),代价大 |
| 引入 `GraphQL` / `oRPC` | 拒;同样路由层重写,前端不直接消费 GraphQL 风格 API,过度设计 |

**应用范围:** 凡是 backend route 接收的 body / 返回的 data shape,**先**在 `packages/shared` 定义 zod schema,**再**用 `z.infer` 派生 TS 类型。前后端 import 同一份。

### 3.4 服务分层 / DI — 不引入 DI 容器,继续 Fastify plugin 模式

**现状:** `apps/server/src/services/*` 已按职责切分;`apps/server/src/app.ts` 用 Fastify `app.prisma` / `app.log` 做"轻量 DI"。

**候选:**

| 库 | 评估 |
|---|---|
| **继续 Fastify plugin + decorator** (推荐) | 已存在;学习成本零;Fastify 官方模式 |
| 引入 `inversify` / `tsyringe` / `awilux` | 拒;服务规模小(< 20 个 service),反射/装饰器开销 > 收益;与 Fastify 装饰器命名空间易冲突 |
| NestJS 风格 | 拒;完全替换 Fastify,代价巨大 |

**应用范围:** 不动。原 ISSUES.md 提到的"类型/服务分层"是"按领域分子包"或"按层级拆文件夹",与 DI 容器无关。

---

## 「库数量」守门

| 项 | 数量 |
|---|---|
| 新引入库 | **0** |
| 实际复用已装库 | 1 个 (`zod` 已在 `shared` + `server` 装着) |
| 调研后被拒候选 | 12 个 (yup / valibot / joi / gpt-tokenizer / tiktoken-node / tRPC / GraphQL / oRPC / inversify / tsyringe / awilix / NestJS) |

**核心结论:** **库不是越多越好**。现状 7+ 个 `js-tiktoken` 重复装、3 套 token 实现 → 真正需要的是**收口**(集中到 1 个文件),不是**加库**。解耦 = 减负,不是加码。

---

## [P2 follow-up] GraphView.vue 重写消费 chapterGraph/cumulativeGraph

**Status:** [RESOLVED 2026-07-29, v3/prepare-archive-stages 分支]

**Context:** v3 重命名 `graphDelta/graphSnapshot` → `chapterGraph/cumulativeGraph`（commit 1）。
当时 GraphView.vue 仍读 `GraphNode` / `GraphEdge` 工作表。

**Resolution:**
- `GraphView.vue` 已改读 v3 `cumulativeGraphApi`（commit adc7df9），只查 `archived` 章节的三列
- `GraphNode` / `GraphEdge` 表已删（migration `20260729000000_drop_graph_node_edge`），`routes/graph.ts` / `api/graph.ts` 一并删除
- `graph-snapshot.ts` 的 `saveGraphSnapshotAndDelta` / `rebuildGraphFromSnapshot` 已删，仅剩 `expandNeighborhood`

---

## 修复时间线

| 日期 | Hash | 说明 |
|------|------|------|
| 2026-06-17 | `e077407` | [P0 #2] 段落感知内容截断,替代 `slice(0, 8000)` |
| 2026-06-17 | `4def263` | [Bonus] cytoscape null `isHeadless` 修复 |
| 2026-06-17 | `bd62a21` | [P0 #8 partial] `js-tiktoken` 7 处重复装收口到 `packages/ai-provider` 1 处 |
| 2026-06-17 | `792b533` | [P0 #8 partial] `packages/ai-provider` re-export `countTokens` |
| 2026-06-17 | `412030a` | [P0 #8 partial] `prompt-runtime` `estimateTokens` → `countTokens`,旧 alias 移除 |
| 2026-06-17 | `4ccfb32` | [P0 #8 partial] `apps/server` 各 service call sites 切到 `countTokens` |
| 2026-06-18 | `18fdd45` | [Bonus/P5] `Graph.vue` 拆 `GraphView` + `EditableGraph` + `useCytoscapeLifecycle` hook,4def263 修复路径迁入共享 hook |
| 2026-06-18 | `4434cb3` | [Bonus/P5 review] 死 import + hook style/layout dedup + `GraphData` 复用 |
| 2026-06-19 | `789f601` | [Dark mode] `--text-on-accent` / `--text-on-dark` 暗色下变暗灰修复 |
| 2026-06-19 | `a4ae45f` | [Dark mode] 4 AA contrast failures + 不可见 border / icon-box 修复 |
| 2026-06-21 | `43077f7` | [Bug] URL 直进设计页时 sider 标题显示"未知小说" |
| 2026-06-21 | `6951a83` | [Bug] ReviewingPanel 4 个 delete action 加 confirm 弹窗 |
| 2026-06-21 | `27b3cff` | [Bug] novel-design sider collapse UX |
| 2026-06-16 | `c98d582` | [P0 #1 / Q4] 移除 `buildData` 的 `user-edited` 注入 |
| 2026-06-16 | `dba2ba1` | [P0 #3 + P0 #4 / Q5] 统一 `JSON.parse` → `safeJsonParse`(graph 路由 + useChapterEditor) |
| 2026-06-16 | `09092ae` | [P0 #5 / Q7] `prepare-archive` 加 try/catch + 状态回滚 |
| 2026-06-16 | `092cc08` | [P0 #6 - GET] AI provider 列表/默认路由排除 `apiKey` |
| 2026-06-16 | `8b5565c` | [P0 #6 - 写路径] AI provider 写路径响应也排除 `apiKey` |
| 2026-06-16 | `116247c` | [P0 #7 / Q8] `select` 路由校验 `draft.chapterId === chapterId` |
| 2026-06-16 | `d2034a6` | [Q1 + Q6] 共享 `ChapterStatus` enum + `PendingArchiveData` 到 `packages/shared` |
| 2026-06-16 | `f0bb424` | [Q3] 删除 `assertStatusTransition` 死代码 |
| 2026-06-16 | `6528301` | [Q3 收尾] 删除 `assertStatusIn` 死代码 |
| 2026-06-16 | `47e0d2c` | [Q9] `generate` 路由用 `CompiledPromptSchema` 校验 |
| 2026-06-16 | `8ce9eaa` | [Q9 补] 拒绝 whitespace-only `compiledPrompt` |
| 2026-06-16 | `510a656` | [Q10] 状态机独占锁(`prepare-archive` / `archive` / `select`) |
| 2026-06-16 | `5f80270` | [Q10] 状态机独占锁(`generate` 409 on concurrent) |

> 注:本表只列与 P0 / Q 决策 / bonus fix **直接相关**的 commit;同一时间段内的纯 docs / 重构 / perf 优化 commit(例如 `99eced2` / `9f1f448` / `c1fb1b6` / `2ec5595` / `b5c931c` / `0b924dc` / `6813e9a` / `cf4aebb` / `a200c4c` / `a06fd3d` / `36727e8` / `8270414` / `ef32358` / `c88ed2e` / `a0f9a77` / `1871f48` / `582a1d3` / `3b417b2` / `c13887f` / `482cca9` / `ce9a2e4` / `7c5ed34` / `08f2939` / `cfd1c81` / `3ff87f4` / `902312d` 等)不计入此表,详见 `git log --since="2026-06-15"`。
