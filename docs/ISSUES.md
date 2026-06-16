# P0 Issues

> 严格 P0：数据丢失 / 崩溃 / 安全。不写修复建议——按你的安排，修复后再说解耦。
> 格式：`## [类别] 标题` + File:line / Symptom / Repro / Root cause hypothesis / Blast radius。
> 类别：`[Data loss]` / `[Crash]` / `[Security]`。
> 每组内按"概率 × 严重度"降序。

---

## [Data loss]

### `buildData` 一刀切打 `user-edited` → 全局记忆优化失效
- **File:line:** `apps/web/src/views/ReviewingPanel.vue:454-465`
- **Symptom:** 用户走过 reviewing 流程的章节，`memory-optimizer` 把整章记忆当 user-edited，整章跳过 AI 融合。新章节的 global 记忆永远不包含这些被"审查过"的内容。
- **Repro:**
  1. 任意章节完成 draft → generated → selected → prepare-archive → 进入 reviewing
  2. 在 ReviewingPanel 点"保存调整"（即使不修改内容，只点按钮）
  3. `buildData` 给所有 memory 加 `user-edited` tag（line 458-463）
  4. 用户点"确认归档" → `chapters.ts:700` 调 `optimizeMemories`
  5. `memory-optimizer.ts:60-64` `userEditedMemories` 覆盖整章 → `autoExtractedMemories` 为空 → `rawText = '暂无本章原始记忆'`
  6. AI 收到的 prompt 里没有本章原始记忆，全局融合实质空跑
- **Root cause hypothesis:** `buildData` 设计假设"用户在 ReviewingPanel 看过/碰过 = user-edited"，但用户即使**不修改**任何 memory 也走 `buildData`。区分"用户实际编辑过"和"用户看过"需要 baseline 对比（deep clone baseline + diff），`ReviewingPanel.vue:224` 有 `baselineChapterGraph`（graph 用的）但 memory 列表没有 baseline。
- **Blast radius:** 所有走过 reviewing 流程的章节（也就是 v1.0 之后的所有章节）。跨章积累。global 记忆层无法反映实际剧情进展，下一章 prompt 拿不到正确的"上一章发生了什么"。

### 章节内容截断到 8000 字，AI 看不到后半部分
- **File:line:** `apps/server/src/services/combined-extractor.ts:148`
- **Symptom:** 章节正文超过 8000 字时，`extractAll` 提交给 AI 的内容是 `content.slice(0, 8000)`。后半部分完全不被 AI 看到，导致记忆/图谱/弧线提取不完整。
- **Repro:**
  1. 写一个 10000 字的章节并归档
  2. 打开 `PromptLog` 查 `callType = 'combined_extract'` 的 `userMessage`
  3. 搜索章节正文中后 2000 字的关键句 —— 找不到
- **Root cause hypothesis:** Prompt 长度限制（避免超过 contextLength），但用 `slice(0, 8000)` 是粗截断而非按 token 预算裁剪/按段落截断。`prompt-runtime` 有 `scaleBudget` 和 `truncate` 能力（`packages/prompt-runtime`），但 `extractAll` 没走那套。
- **Blast radius:** 任何 > 8000 字的章节。2000 字大纲+8000 字正文 ≈ 中等长度章节，**绝大多数长篇章节会触发**。

---

## [Crash]

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

### `routes/graph.ts:18` `JSON.parse` 无 try/catch 保护
- **File:line:** `apps/server/src/routes/graph.ts:18`
- **Symptom:** GET `/api/stories/:id/graph` 路由读 `lastArchived.graphSnapshot` 并 `JSON.parse`，**完全无 try/catch**。graphSnapshot 字段是 `String?` 存 JSON 文本，任何损坏（写入时序错、字符截断、DB 迁移异常）会让整个 GET 请求 500。
- **Repro:**
  1. 模拟 graphSnapshot 损坏：`prisma/dev.db` 手动 `UPDATE Chapter SET graphSnapshot = 'broken json' WHERE ...`
  2. `curl http://localhost:3000/api/stories/:id/graph` → 500 Internal Server Error
  3. 前端 Graph 视图打不开
- **Root cause hypothesis:** 其他 AI 输出解析点（`graph-organizer.ts:96`、`memory-optimizer.ts:136` 等）都有专门 try/catch。`routes/graph.ts:18` 是项目里**唯一**对 `JSON.parse` 完全无保护的 DB 字段读取。
- **Blast radius:** 任何章节 graphSnapshot 损坏时。出现概率不高（graphSnapshot 由后端写入），但**一旦触发就是全图谱视图不可用**。

### `prepare-archive` 路由无 try/catch 包裹 `prepareArchiveData`
- **File:line:** `apps/server/src/routes/chapters.ts:585`
- **Symptom:** `const pending = await prepareArchiveData(...)` 直接 throw。`organizeGraph` 抛错（line 119 `throw err`）会冒泡到 Fastify 全局错误处理 → 500。前端 `prepareArchive` 收到 500，但 `chapter.status` 仍为 `selected`（line 602-608 在抛错后不执行）。
- **Repro:**
  1. 让 AI 返回 graph 整理结果但 JSON 格式损坏（修改 prompt 让 AI 输出 markdown 包裹的 JSON）
  2. `organizeGraph` line 96 `JSON.parse` 抛错
  3. 冒泡 → `prepare-archive` 路由 500
  4. 前端 `useChapterEditor.ts:158` catch 错误，`currentChapter.value.status` 仍为 `selected`，message.error 提示
  5. 用户可以重试（重新点"准备归档"），但每次都会重跑 `extractAll`（浪费 token）
- **Root cause hypothesis:** 与同文件 `archive` 路由（line 657-704）有完整 try/catch 形成对比——`archive` 路由事务+`optimizeMemories` 都有保护。`prepare-archive` 路由作者**忘了**对 `prepareArchiveData` 加保护。
- **Blast radius:** 任何 `organizeGraph` 抛错的章节。出现概率取决于 AI 输出格式稳定性。

---

## [Security]

### `ai-provider.ts` GET 路由不排除 `apiKey` 字段 → 明文 Key 泄漏
- **File:line:** `apps/server/src/routes/ai-provider.ts:6-11`（列表）+ `apps/server/src/routes/ai-provider.ts:14-22`（默认）
- **Symptom:** GET `/api/ai-providers` 和 GET `/api/ai-providers/default` 直接 `findMany/findFirst` 无 `select`，返回的 `data` 包含**所有 AI Provider 的明文 `apiKey`**。任何能访问应用的人（`KNOWN-ISSUES.md` S1 指出无任何认证）都能 `curl /api/ai-providers` 拿到所有 Key。
- **Repro:**
  1. 启动应用，`.env` 配了 `DEEPSEEK_API_KEY=sk-xxx`（启动时被 `ai-provider-init.ts:96` 写入 DB）
  2. `curl http://localhost:3000/api/ai-providers` （无任何认证 header）
  3. 响应 `data` 数组的每个元素 `apiKey` 字段就是明文 `sk-xxx`
- **Root cause hypothesis:** Prisma `findMany` 默认返回所有列（**包括 secret**）。前端需要 Provider 配置做下拉菜单，但**只需要 id/name/model/remarks/isDefault 等非敏感字段**。修复需要在 `select` 里排除 `apiKey`。**对比**：`apps/server/src/services/ai-provider-init.ts:96` 写入是必要的（让后端能调 API），但路由返回不应该带出来。
- **Blast radius:** **100% 触发**——任何 GET 调用都泄漏。结合项目**无认证**（`KNOWN-ISSUES.md` S1），部署到非本机环境就是**远程泄漏所有 AI Provider Key**。这是 P0 最高优先级。

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

---

*生成工具：见 `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md`。共 7 条 P0（2 数据丢失 / 3 崩溃 / 2 安全）。修复顺序建议：安全类先（2 条）→ 崩溃类（3 条）→ 数据丢失类（2 条）。*
