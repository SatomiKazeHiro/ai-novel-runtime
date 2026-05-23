# 分支式章节生成系统 — 实现清单

> 本文档记录项目的总体目标、已完成的阶段、以及待完成的阶段清单。新窗口/agent 应以此文件为起点继续开发。

---

## 一、总体目标

打造一个**分支式章节生成系统**：每个章节独立存储内容，可基于任意章节"发展"出多个下一章（多分支），形成类似 Git Graph 的章节树。系统支持写作人格绑定、可编辑生成 Prompt、异步候选生成、AI 评分、图谱变化追踪。

核心公式：
```
下一章内容 = 全局信息（小说、世界观、角色、写作人格、文风）
          + 上一归档章节的环境（记忆、图谱、弧线）
          + 当前章节的配置（大纲、场景）
```

---

## 二、已完成 ✅

### 阶段 1：数据库 + 基础 API

**数据库 Schema 变更**（`prisma/schema.prisma`）：
- `Chapter` 新增 `parentChapterId`/`branchName`/`runtimeProfileId`/`compiledPrompt`/`graphDelta`/`graphSnapshot`
- `Draft` 新增 `temperature`/`maxTokens`/`compiledPrompt`/`score`/`errorMessage`/`updatedAt`，`status` 扩展
- 迁移 `20260522211910_add_chapter_branch_and_draft_enhance` 已应用

**后端 API**：
- `POST /api/chapters/:chapterId/develop` — 发展下一章/番外
- `GET /api/stories/:storyId/chapter-tree` — 获取章节分支树

**Bug 修复**：
- `loadRuntimeBase` 修复为从 `Story.runtimeProfileId` 查人格
- Worker Task 硬编码兜底中性化

### 阶段 2：前端分支树 UI ✅

**`ChapterBranchTree.vue`**：
- 递归渲染章节分支树，Git Graph 风格（缩进 + CSS 连接线）
- 节点状态指示（颜色圆点 + 标签）：archived/selected/generated/draft
- 操作按钮：发展（archived/selected 章节）、编辑、删除
- 删除规则：archived 且有 archived 子节点 → 不可删除

**`Chapters.vue` 重构**：
- 分支树视图 ↔ 编辑子页面切换
- 编辑子页面三步骤：
  - Step 1：配置区（写作人格选择、剧情弧线展示、大纲编辑、场景编辑）
  - Step 2：生成区（可编辑 Prompt、默认/自定义候选生成、预算仪表盘、候选卡片 3 Tab）
  - Step 3：正文与归档（正文编辑、保存、归档）
- 新建根章节弹窗、发展弹窗、自定义候选弹窗

**前后端编译状态**：
- 后端 `apps/server`：编译通过 ✅
- 前端 `apps/web`：编译通过 ✅

---

## 三、待完成 📋（阶段 3-6）

### 阶段 3：生成流程改造（异步生成） ✅

- [x] 后端 `/generate` 改造为异步流程：
  - [x] 创建 Draft 记录（`status=generating`）后立即返回
  - [x] 加入队列（`generateQueue.add`），由 `generate-processor` 后台执行
  - [x] 成功时更新 `content`、`status=completed`、`compiledPrompt`
  - [x] 失败时 `status=failed` + `errorMessage`
- [x] 前端轮询：`GET /api/chapters/:id/drafts` 每 2 秒查状态
  - [x] generating 状态显示 spinner 动画 + "AI 正在创作中..."
  - [x] completed 后自动刷新候选列表并停止轮询
  - [x] failed 显示错误信息

### 阶段 4：评分系统 ✅

- [x] 实现 AI 评分（`apps/server/src/routes/scores.ts`）：
  - [x] 后端评分路由组装专业评分 Prompt（7 维度：文风接近度/大纲符合度/场景符合度/写作人格一致性/文笔质量/情感张力/节奏把控）
  - [x] 调用 AI 进行评分，解析 JSON 结果
  - [x] 保存到 `Score` 表，同时更新 `Draft.score` 字段
  - [x] 获取最近 2-3 个 archived 章节作为文风参考
  - [x] 获取写作人格信息用于人格一致性评分
- [x] `scoring-engine` 接口更新：
  - [x] `ScoreResult` 更新为 7 维度新结构
  - [x] `RuleBasedScorer` 作为 AI 评分失败时的兜底
- [x] 前端评分展示弹窗：
  - [x] 综合评分大数字展示
  - [x] 7 维度进度条可视化
  - [x] AI 评语展示

### 阶段 5：归档与图谱 ✅

- [x] 归档时计算 `graphSnapshot` 和 `graphDelta`：
  - [x] 新增 `apps/server/src/services/graph-snapshot.ts`
  - [x] `buildGraphSnapshot()`：查询当前 story 所有节点和边，序列化为 JSON
  - [x] `computeGraphDelta()`：对比上一章快照与当前快照，计算新增节点/更新节点/新增边
  - [x] `saveGraphSnapshotAndDelta()`：归档时自动保存到 `Chapter.graphSnapshot` / `Chapter.graphDelta`
  - [x] 优先对比父章节快照，否则取最近归档章节
- [x] 归档后前端展示：
  - [x] `Chapters.vue` 编辑页面新增"本章图谱变化"卡片
  - [x] 展示 summary、新增节点标签、更新节点详情、新增关系列表

### 阶段 6：知识图谱页面增强 ✅

- [x] 分支视角切换：
  - [x] `Graph.vue` 新增"实时图谱" / "分支快照" 切换
  - [x] `computeBranches()`：从 chapter tree 计算所有分支路径（从根到叶子，取路径上最后一个 archived 章节）
  - [x] 默认选择最长分支（最深路径）
- [x] 分支选择器：下拉框列出所有分支路径
- [x] 展示选定分支最后一个归档章节的 `graphSnapshot`
- [x] 后端新增 `GET /api/chapters/:chapterId/graph-snapshot` API

---

## 四、关键设计决策（已确定）

### 4.1 分支树查询

Prisma 不支持递归 CTE，章节树在前端通过 `GET /api/stories/:storyId/chapter-tree` 返回已拼好的嵌套结构。后端实现：
1. 查询所有章节（`where: { storyId }`）
2. 用 Map 构建父子关系
3. 返回根节点数组（每个节点含 `children` 数组）

### 4.2 graphSnapshot 存储策略

**方案 A（已确定）**：每章归档时预计算完整图谱快照存入 `graphSnapshot`
- 优点：查询快，无需回溯
- 缺点：存储冗余（每章存一份完整图谱）
- 可接受：图谱数据量通常不大（节点数百、边数千）

### 4.3 异步生成方案

同步生成但前端轮询：
1. 创建 Draft（`status=generating`）
2. 后端同步调用 AI
3. 完成后更新 Draft（`status=completed` + `content` + `compiledPrompt`）
4. 前端轮询 `GET /api/chapters/:id/drafts`

长期可接入 BullMQ 队列改为真正异步。

### 4.4 删除规则

```typescript
function canDelete(chapter: Chapter): boolean {
  if (chapter.status !== 'archived') return true // draft 等随意删除
  const hasArchivedDescendant = await prisma.chapter.count({
    where: { storyId: chapter.storyId, parentChapterId: chapter.id, status: 'archived' }
  }) > 0
  return !hasArchivedDescendant
}
```

### 4.5 Worker Task 策略

- 去除显式配置界面（`WorkerTask.vue`、`StoryWorkerTask.vue` 隐藏或简化）
- 保留 `loadWorkerTask()` 底层加载逻辑
- 硬编码兜底为中性通用声明
- 风格控制完全交给**写作人格（RuntimeProfile）**

---

## 五、已知问题与注意事项

### 5.1 数据库迁移历史

迁移文件按时间顺序：
1. `20260516092617_init` — 初始建表
2. `20260518000000_add_runtime_profile_worker_task_plot_arc`
3. `20260518000001_add_ai_provider_context_length`
4. `20260518022500_add_prompt_log`
5. `20260518023000_add_chapter_side_story`
6. `20260518104226_add_character_identity_appearance_temperament`
7. `20260522211910_add_chapter_branch_and_draft_enhance` ← 最新

**注意**：开发环境曾执行过 `prisma migrate reset`，数据已清空。如需保留数据请谨慎操作。

### 5.2 Chapter.number 语义变化

`number` 字段从"全局递增序号"变为"同一父章节下的展示序号"。当前实现中：
- 根章节：`number` 仍按传统递增（1, 2, 3...）
- 子章节：`number = 同父最大序号 + 1` 或用户指定
- `@@unique([storyId, number])` 仍然保留，但同一 story 下不同分支的 number 可能冲突

**潜在问题**：如果第 1 章发展出两个第 2 章，它们的 `number` 会是 2 和 3（递增），这实际上不会冲突。但如果第 1 章（number=1）有两个子章节（number=2, 3），第 2 章（number=2）又有一个子章节（number=3），这和第 1 章的另一个子章节 number=3 在同 story 下会冲突！

**建议**：考虑去掉 `@@unique([storyId, number])` 约束，或者让 `number` 只用于展示，不保证唯一性。

### 5.3 RuntimeProfile 加载优先级（修复后）

```
1. Chapter.runtimeProfileId（章节级覆盖）
2. Story.runtimeProfileId（小说级默认）
3. isDefault=true 的全局默认 Profile
4. 硬编码兜底（中性通用）
```

### 5.4 代码位置速查

| 功能 | 文件 |
|------|------|
| 章节路由（含 /develop /chapter-tree） | `apps/server/src/routes/chapters.ts` |
| 角色路由 | `apps/server/src/routes/characters.ts` |
| 写作人格加载 | `apps/server/src/services/runtime-loader.ts` |
| Worker Task 加载 | `apps/server/src/services/runtime-loader.ts` |
| 合并提取器 | `apps/server/src/services/combined-extractor.ts` |
| 记忆整理 | `apps/server/src/services/memory-organizer.ts` |
| Prompt Pipeline | `packages/prompt-runtime/src/index.ts` |
| 预算缩放 | `packages/shared/src/index.ts` (`scaleBudget`) |
| 章节工作台 | `apps/web/src/views/Chapters.vue` |
| 分支树组件 | `apps/web/src/components/ChapterBranchTree.vue` |
| 角色管理 | `apps/web/src/views/Characters.vue` |
| 模型管理 | `apps/web/src/views/ModelManager.vue` |

---

## 六、API 速查

### 新增 API

```
POST /api/chapters/:chapterId/develop
  body: { title?, outline?, isSideStory?, number?, branchName?, runtimeProfileId? }
  → { success: true, data: Chapter }

GET /api/stories/:storyId/chapter-tree
  → { success: true, data: ChapterNode[] }
  // ChapterNode = Chapter + { children: ChapterNode[], runtimeProfile?: { name } }
```

### 现有关键 API

```
POST /api/stories/:storyId/chapters       → 创建章节
GET  /api/stories/:storyId/chapters       → 列表（传统列表，后续可能被 chapter-tree 替代）
POST /api/chapters/:chapterId/preview     → Prompt 预览
POST /api/chapters/:chapterId/generate    → 生成候选（同步，需改造为异步）
POST /api/chapters/:chapterId/select      → 采用 Draft
POST /api/chapters/:chapterId/archive     → 归档
PUT  /api/chapters/:chapterId             → 更新章节（大纲/正文/场景）
```

---

*文档更新于：2026-05-23*
*阶段 2 完成时间：2026-05-23*
