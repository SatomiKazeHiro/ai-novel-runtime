# V2 小说设计整体重建设计

> 日期: 2026-06-29
> 状态: §7 全部阶段已落地（Phase 0-6, 2026-07-03）；实施过程中关键决策见 §0 实施状态。

## 0. 实施状态

> 更新日期: 2026-07-04
> 全流程联调测试通过；详见 `docs/v2-architecture.md` §10 一句话总结。

### Phase ↔ 状态映射

| 阶段 | 标题 | 状态 | 关键产出 |
|------|------|------|----------|
| Phase 0 | 基础设施 | ✅ 完成 | Prisma V2 表 + `routes-v2/index.ts` 骨架 + `services-v2/` + 前端 `views-v2/` + `composables-v2/` + `api-v2/` |
| Phase 1 | 角色管理 | ✅ 完成 | V2Character CRUD + V2CharacterSnapshot 查询 + 列表/详情页 |
| Phase 2 | 记忆模块 | ✅ 完成 | V2Memory CRUD + 临时记忆 + 浏览页（按类型/分类筛选） |
| Phase 3 | 剧情弧线 | ✅ 完成 | V2PlotArc + 状态筛选 + 列表页 + 章节关联展示 |
| Phase 4 | 章节工作台（核心） | ✅ 完成 | V2Chapter CRUD + 配置保存 + SSE 生成 + 5 路并行分析 + 归档 |
| Phase 5 | 时间线 + 图谱 + 平移 | ✅ 完成 | V2Timeline/V2Graph + lore/worker-tasks/prompt-logs 从 v1 平移 |
| Phase 6 | 配置面板 + 收尾 | ✅ 完成 | ConfigPanel 4 类数据源（角色/记忆/弧线/世界观）可调 + 全流程联调 |

### 关键决策（实施过程中从 spec 偏离或细化）

- **Q6 — 4 态状态机**（§7.4 Phase 4 偏离）：故意偏离 V1 8 态为 V2 4 态（`draft`/`analyzing`/`archived`，`generating` 实际只在 v2Draft 上），绕开 V1 的 `updateMany` 原子锁 + 4 套 allowed-status 白名单分散维护。详见 `v2-architecture.md` §6.3。
- **Q7 — 5 extractor 公共层**：实施时抽出 `services-v2/extractor-base.ts`（commit `1f69418`），5 个 extractor 共享 AI 调用包装 / JSON 解析，与 spec 解耦优先原则对齐。V1 不动 = 参考留档最终清除。
- **Q10 — analyze 前端 180s 总超时**：spec 未明确；实施时新增，前端 `analyze` 包裹 `AbortController` 设 180s deadline；per-extractor timeout 不加（避免与 provider 120s 高度重叠冗余）。
- **Q11 — V2ChapterDesign 拆 Step3+Step4**（结构性）：实施时把单文件 1193 行拆为父 + 子组件 `views-v2/_components/V2Step{3,4}Panel.vue`，spec 未规定。
- **Q12 — routes-v2/chapters.ts 拆 6 文件**（结构性）：实施时把 650 行单文件按职责拆 6 兄弟（CRUD + archive + analysis + config + drafts + generate）+ `provider-configs.ts` 独立；spec 未规定。

### 进一步决策与未尽问题

- **Q9（暂缓）**：暂不实施，触发条件见 `v2-architecture.md` §7.4。

---

## 1. 定位与原则

### 三方定位

| 角色 | 职责 |
|------|------|
| **作者** | 设计大纲、选择 AI 候选文章、过滤归档信息 |
| **AI** | 量产多候选数据（量变 → 质变），不干涉作者 |
| **本系统** | 作者与 AI 的桥梁：数据记录、告警提示、稳定性保障 |

### 设计原则

- **兜底克制**：只做系统稳健运行的基础兜底，数据层面不做处处兜底。兜底方案必须先讨论后实施
- **物理隔离**：v2 代码零引用 v1 业务代码，仅复用 CSS token / Naive UI 配置 / NavBar / story store / HTTP 实例
- **不迁移旧数据**：v2 用全新数据测试，旧表不动
- **解耦优先**：每个模块独立，互不拖累

---

## 2. 隔离边界

### 可复用（基础设施）

- `styles/tokens.ts` — CSS 变量、PALETTES、颜色、字体
- Naive UI 全局配置（n-config-provider）
- `components/NavBar.vue` — 顶部导航栏
- `stores/story.ts` — 当前选中小说
- `stores/theme.ts` — 主题状态
- HTTP 实例（axios/fetch baseURL、错误拦截器）

### 不复用（业务层）

- 所有 views、composables、API 函数 — v2 全部自建
- v2 API 对接 v2 自己的后端路由

### 命名空间

- 前端路由: `/novel-design-v2/:storyId`
- 后端路由: `/api/v2/...`
- DB 表: Prisma model `V2Xxx`，SQLite 表名 `V2Xxx`

---

## 3. 整体架构

```
Frontend (apps/web)
├─ 共享: CSS tokens / NavBar / story store / HTTP 实例
├─ V1: /novel-design/:storyId (不动)
└─ V2: /novel-design-v2/:storyId (全新)
    ├─ views-v2/
    ├─ composables-v2/
    └─ api-v2/

Backend (apps/server)
├─ V1: routes/ + services/ (不动)
└─ V2: routes-v2/ + services-v2/ (全新)
    └─ 路由前缀 /api/v2/

Database (同一 SQLite 文件)
├─ V1 表: Chapter, Memory, Character, GraphNode, ...
└─ V2 表: V2Character, V2Memory, V2PlotArc, V2Chapter, ...
```

---

## 4. 数据模型

### 4.1 角色模块

```prisma
model V2Character {
  id            String   @id @default(uuid())
  storyId       String
  slug          String   // 英文标识，唯一
  name          String   // 姓名
  isProtagonist Boolean  // 是否主角
  appearance    String?  // 外貌
  temperament   String?  // 气质
  personality   String?  // 性格
  speechStyle   String?  // 说话风格
  createdAt     DateTime
  updatedAt     DateTime
  snapshots     V2CharacterSnapshot[]
}

model V2CharacterSnapshot {
  id            String   @id @default(uuid())
  characterId   String
  chapterNumber Int      // 冗余，方便查询
  identity      String?  // 身份
  appearance    String?  // 外貌
  temperament   String?  // 气质
  personality   String?  // 性格
  speechStyle   String?  // 说话风格
  relationships String?  // 关系（JSON 文本）
  status        String?  // 状态（JSON 文本）
  createdAt     DateTime
}
```

### 4.2 记忆模块

```prisma
enum V2MemoryType {
  global
  chapter
  scene
  temporary
}

enum V2MemoryCategory {
  relationship_change
  foreshadowing
  emotional_change
  event_memory
}

model V2Memory {
  id                  String          @id @default(uuid())
  storyId             String
  type                V2MemoryType
  category            V2MemoryCategory
  content             String
  importance          Int             // 0-10，AI 评分，硬编码兜底 4
  participants        String?         // 逗号分隔（event_memory 用）
  originChapterNumber Int?
  isActive            Boolean         // 合并后旧版标记 false
  createdAt           DateTime
  updatedAt           DateTime
}

model V2MemoryMergeLog {
  id              String   @id @default(uuid())
  storyId         String
  chapterNumber   Int
  inputMemoryIds  String   // JSON 数组
  outputMemoryIds String   // JSON 数组
  createdAt       DateTime
}
```

**记忆分类规则：**

| 分类 | 描述格式 |
|------|---------|
| `relationship_change` | 和 v1 一样，描述关系变化 |
| `foreshadowing` | 可能的伏笔描述 |
| `emotional_change` | XX 对 YY 因为 ZZ 事件在态度/情绪/认知上变成了 NN/MM |
| `event_memory` | 事件描述 \| 参与者：XX、YY、ZZ |

**重要度规则：**
- AI 根据记忆在文中的作用评分，默认 4~6
- 主角参与时 +1
- 最高 10，最低 0
- 硬编码兜底：4

### 4.3 剧情弧线模块

```prisma
enum V2PlotArcStatus {
  active
  interrupted
  completed
  closed
}

model V2PlotArc {
  id                     String          @id @default(uuid())
  storyId                String
  title                  String
  description            String
  status                 V2PlotArcStatus
  isMainline             Boolean         // 主角参与 = 主线
  firstChapterNumber     Int
  lastUpdateChapterNumber Int
  createdAt              DateTime
  updatedAt              DateTime
}

model V2PlotArcDraft {
  id          String   @id @default(uuid())
  plotArcId   String?  // 关联已有弧线（create 时为 null）
  chapterId   String
  action      String   // create / update / close
  title       String
  description String
  status      V2PlotArcStatus
  isMainline  Boolean
  mergeInfo   String?  // 合并说明（AI 产出）
  createdAt   DateTime
}
```

**状态机：**
- `active` → 正在推进
- `interrupted` → 超过 5 章未更新（归档后硬编码检测并标记）
- `completed` → 剧情完成
- `closed` → AI 发现重复弧线，去重关闭

### 4.4 章节模块

```prisma
enum V2ChapterStatus {
  draft
  generating
  analyzing
  archived
}

model V2Chapter {
  id          String          @id @default(uuid())
  storyId     String
  number      Float           // 支持小数侧线（如 1.01）
  title       String
  content     String          // 正文
  contentHash String          // SHA256，每次保存时生成
  status      V2ChapterStatus
  analysisId  String?         // 分析时的 contentHash，归档前校验
  config      String          // prompt 配置快照（JSON）
  createdAt   DateTime
  updatedAt   DateTime
  drafts      V2Draft[]
}

model V2Draft {
  id        String        @id @default(uuid())
  chapterId String
  content   String
  status    String        // generating / completed / failed / deleted
  createdAt DateTime
  updatedAt DateTime
}
```

**状态流转：**
```
draft → generating → analyzing → archived
         (SSE 生成)   (5路分析)   (事务写入)
```

**Hash 校验规则：**
- 正文每次保存 → 生成 SHA256 哈希
- 分析阶段 ID = 分析时的正文哈希
- 归档前：`contentHash === analysisId ?` 不等 → 弹窗提示

### 4.5 时间线模块（空数据）

```prisma
model V2TimelineAnchor {
  id       String @id @default(uuid())
  storyId  String
  position Float  // Y.DDDHH 编码
  label    String
}

model V2TimelineEvent {
  id             String @id @default(uuid())
  anchorId       String
  chapterNumber  Int
  description    String
}
```

**说明：** 表结构先建好，接口返回空数据，后续阶段再实现提取逻辑。事件与时间锚点 N:1 关系，不再存 JSON 结构。

### 4.6 图谱模块（空数据）

不新建表。图谱接口返回 `{ nodes: [], edges: [] }`。

---

## 5. 后端设计

### 5.1 路由结构

```
apps/server/src/routes-v2/
  index.ts                  — 统一注册，prefix: /api/v2
  characters.ts             — 角色 CRUD + 快照查询
  characters-analysis.ts    — AI 提取角色 → 匹配现有 → 返回草稿
  memories.ts               — 记忆查询 + 临时记忆 CRUD
  memories-analysis.ts      — AI 提取记忆 → 全局合并
  plot-arcs.ts              — 弧线查询
  plot-arcs-analysis.ts     — AI 提取弧线 → 去重合并
  chapters.ts               — 章节 CRUD + 配置保存
  chapters-generate.ts      — SSE 候选文章生成
  chapters-analysis.ts      — 分析状态查询（GET /status）
  chapters-archive.ts       — 归档：校验 → 事务写入 → 后处理
  timeline.ts               — 时间线（空数据）
  graph.ts                  — 图谱（空数据）
  lore.ts                   — 世界观
  worker-tasks.ts           — 任务模板
  prompt-logs.ts            — 调用日志
```

### 5.2 服务层

```
apps/server/src/services-v2/
  ai-provider.ts            — 封装 AI 调用
  ai-call-logger.ts         — AI 调用日志记录
  character-extractor.ts    — 从正文提取角色
  memory-extractor.ts       — 从正文提取记忆（4 类型 × 4 分类）
  memory-merger.ts          — 全局记忆合并
  plot-arc-extractor.ts     — 从正文提取弧线（更新 + 新增 + 关闭）
  plot-arc-merger.ts        — 弧线去重合并
  plot-arc-interrupt.ts     — 归档后检测 >5 章未更新 → interrupted
  config-defaults.ts        — prompt 配置硬编码默认值
  prompt-assembler.ts       — 根据配置组装 prompt
  hash.ts                   — SHA256 正文哈希
```

### 5.3 分析流程（5 路完全独立）

前端同时发 5 个独立请求：

```
POST /api/v2/chapters/:id/analyze/characters   → 提取 + 匹配 → V2CharacterDraft[]
POST /api/v2/chapters/:id/analyze/memories     → 提取 + 合并 → V2MemoryDraft[]
POST /api/v2/chapters/:id/analyze/plot-arcs    → 提取 + 合并 → V2PlotArcDraft[]
POST /api/v2/chapters/:id/analyze/timeline     → 空实现，返回 []
POST /api/v2/chapters/:id/analyze/graph        → 空实现，返回 {nodes:[], edges:[]}
```

每路独立生命周期：
```
pending → extracting (AI 第一次调用) → merging (AI 二次调用) → done
                                                              → failed
```

- 谁先完成就先展示，不互相等待
- 失败的模块显示失败原因，作者可单独"重新分析"/"撤销分析"
- 每路 AI 调用均通过 `ai-call-logger` 记录

### 5.4 SSE 候选文章生成

```
GET /api/v2/chapters/:chapterId/generate-stream

事件流:
  event: draft-start     { draftId, index }
  event: draft-chunk     { draftId, delta }
  event: draft-complete  { draftId, fullContent }
  event: draft-error     { draftId, error }
  event: all-complete    { count }
```

- 多个候选文章并行生成，各独立 SSE event
- 作者可在生成中途删除/追加 draft
- 无 Redis 时走内存队列，不做伪降级

### 5.5 归档流程

```
作者点"归档"
  ├─ contentHash === analysisId ?
  │    ├─ 相等 → 进入二次确认
  │    └─ 不等 → "正文已修改但未重新分析，是否继续？"
  │              [取消] → 回去分析 / [继续归档]
  │
  └─ 二次确认: "即将归档，是否继续？"
       （弹窗位置偏移，确认按钮与上一步不同位置）
       [取消] [确认归档]
              │
              └─ 事务写入:
                   V2CharacterSnapshot (分析结果)
                   V2Memory (记忆写库)
                   V2PlotArc (弧线更新)
                   V2Chapter.status = 'archived'
                   V2Chapter.content (如有改动)
                 │
                 └─ 后处理:
                      plot-arc-interrupt: 检测 >5 章未更新弧线 → interrupted
```

---

## 6. 前端设计

### 6.1 路由

```ts
{
  path: '/novel-design-v2/:storyId',
  component: NovelDesignV2Layout,
  children: [
    { path: 'characters',     component: V2Characters },
    { path: 'lore',           component: V2LoreBook },
    { path: 'chapters',       component: V2Chapters },
    { path: 'reader',         component: V2ChapterReader },
    { path: 'plot-arcs',      component: V2PlotArcs },
    { path: 'memory',         component: V2Memory },
    { path: 'graph',          component: V2Graph },
    { path: 'timeline',       component: V2Timeline },
    { path: 'worker-tasks',   component: V2StoryWorkerTask },
    { path: 'prompt-logs',    component: V2PromptLogs }
  ]
}
```

### 6.2 目录结构

```
apps/web/src/
  views-v2/
    NovelDesignV2Layout.vue
    V2Characters.vue
    V2CharacterDetail.vue       — 角色查看页（左基础+右快照）
    V2Chapters.vue              — 章节列表
    V2ChapterDesign.vue         — 章节设计页
    V2LoreBook.vue
    V2Memory.vue
    V2PlotArcs.vue
    V2Graph.vue                 — 空占位
    V2Timeline.vue              — 空占位
    V2ChapterReader.vue
    V2StoryWorkerTask.vue
    V2PromptLogs.vue

  composables-v2/
    useChapterConfig.ts
    useDraftGeneration.ts
    useChapterAnalysis.ts
    useCharacterMatching.ts

  api-v2/
    characters.ts
    memories.ts
    plotArcs.ts
    chapters.ts
    lore.ts
    timeline.ts
    graph.ts
    workerTasks.ts
    promptLogs.ts
```

### 6.3 菜单结构

```ts
menuOptions = [
  '角色管理'   → /novel-design-v2/:id/characters
  '世界观'     → /novel-design-v2/:id/lore
  '章节工作台' → /novel-design-v2/:id/chapters
  '阅读'       → /novel-design-v2/:id/reader
  '剧情弧线'   → /novel-design-v2/:id/plot-arcs    ← v2 新增
  '记忆管理'   → /novel-design-v2/:id/memory
  '知识图谱'   → /novel-design-v2/:id/graph
  '时间线'     → /novel-design-v2/:id/timeline
  '任务模板'   → /novel-design-v2/:id/worker-tasks
  '调用日志'   → /novel-design-v2/:id/prompt-logs
]
```

### 6.4 关键页面布局

#### 角色管理（V2Characters.vue → V2CharacterDetail.vue）

列表页：表格（标识/姓名/主角/操作）
点击"查看" → 详情页（左：基础信息 | 右：快照，默认最新，下拉切换章节）

#### 章节工作台

列表页（V2Chapters.vue）：章节表格 + 状态标签 + 设计/阅读/删除操作 + 新建/侧线按钮
点击"设计" → 设计页（V2ChapterDesign.vue）：
- 配置区（阶段 6 前展示硬编码摘要，阶段 6 后可展开调整）
- 生成区（SSE 候选流式展示 / 直接输入正文）
- 分析区（5 个独立面板，各自状态 + 重试/撤销）
- 归档按钮 + 二次确认弹窗

#### 配置面板（阶段 6）

每个配置项以列表下拉形式展示可选数据源，默认按硬编码勾选：
- 角色：有内容时自动勾选
- 记忆：全局 + 临时默认勾选
- 剧情弧线：活跃的默认勾选
- 世界观：有内容的自动勾选

硬编码逻辑届时参考 v1 逐个讨论。

---

## 7. 实施阶段

### 阶段 0: 基础设施
- Prisma V2 表全量迁移
- `routes-v2/index.ts` 路由注册骨架
- `services-v2/` 空骨架
- 前端路由 + NovelDesignV2Layout 空壳 + api-v2/ HTTP 封装
- 产出：各页面 "V2 开发中" 占位

### 阶段 1: 角色管理
- V2Character CRUD + V2CharacterSnapshot 查询
- 列表页 + 详情页（左基础信息 + 右快照）

### 阶段 2: 记忆模块
- V2Memory 查询 + 临时记忆 CRUD
- 记忆浏览页（按类型/分类筛选）

### 阶段 3: 剧情弧线
- V2PlotArc 查询 + 状态筛选
- 弧线列表页 + 章节关联展示

### 阶段 4: 章节工作台（核心）
- V2Chapter CRUD + 配置保存 + SSE 生成 + 5 路分析 + 归档
- 完整的 ChapterDesign 流程

### 阶段 5: 时间线 + 图谱 + 平移模块
- 时间线空接口 + 图谱空接口
- lore / worker-tasks / prompt-logs 从 v1 平移
- V2Timeline / V2Graph 占位

### 阶段 6: 配置面板 + 收尾
- ConfigPanel 4 类数据源可调
- 硬编码逻辑参考 v1 逐个讨论
- 全流程联调测试

### 每阶段开发流程

1. AI 从 spec 明确本阶段内容
2. 问用户是否需要对比 v1 实现
3. 问用户有无调整/补充
4. 用户拍板
5. AI 实现
6. 完成后进入下一阶段

---

## 8. 不做的

- 旧数据迁移到新表
- 分析阶段的评分系统（v1 的 score 维度）
- 图谱/时间线的 AI 提取实现（留到后续阶段）
- 配置面板的 4 类数据源交互（阶段 6 前仅硬编码）
- 处处兜底（兜底方案逐个讨论后决定）
