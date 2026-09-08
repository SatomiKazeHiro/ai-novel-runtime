# v3 CharacterBranchState 写库接通

**Goal:** 修 v3 已知遗留 — `chapters-archive.ts:archive` 端点不写 `CharacterBranchState` 表,导致 `chapters-generate.ts:getCharactersWithLatestState` 永远拿 fallback `{}`,AI 生成下一章时拿不到本章确立的角色状态/关系。

**Scope:** 接通 archive confirm 端点 → 写 `CharacterBranchState`;`isNew=true` 静默跳过(Character 是手动 CRUD,无法 auto-create)。

**Out of scope:**
- `latestBranchStates` 链路死代码清理(`chapters-archive.ts:111,302` 查到后没人用) — 单独任务
- Characters.vue UI `branchStates?.[0]` 无排序修 — 单独任务
- `CharacterBranchState.fromChapterNumber Float?` schema 类型评估 — 单独任务
- CharacterStage prompt 改写(质量评估) — 后续若需要

---

## 0. 现状摘要

### 0.1 数据流

```
chapter 内容
  ↓ runCharacterStage (stages/character-stage.ts)
  ↓ character-stage 输出 characterStates[] (status + relationships JSON)
  ↓ 写 pendingArchiveData.stages.character.result.characterStates ✅
  ↓
  ❌ [断开] archive confirm 端点的 prisma.$transaction 不写 CharacterBranchState
  ↓ chapters-generate.ts:getCharactersWithLatestState 永远拿到 fallback {}
  ↓ AI 生成下一章时,prompt 里 character.status / character.relationships = "{}"
  ↓ AI 不记得本章发生了什么
```

### 0.2 现有 CharacterBranchState 写入路径 (2 处,都是手动 CRUD)

| 位置 | 触发 | fromChapterNumber |
|------|------|-------------------|
| `routes/characters.ts:35` | `POST /api/characters` (创建角色) | `null` (初始) |
| `routes/characters.ts:67` | `PUT /api/characters/:id` (更新角色) | `body.fromChapterNumber ?? null` |

**整个 DB 从未有过 archive 写入的非空行。** 87be28a9 实证:4 行 (2 故事 × 2 角色) 全部 `status={} relationships={}`,全仓 0 行非空。

### 0.3 真实消费者

`chapters-generate.ts:35-44 getCharactersWithLatestState`:
- 查所有 Character
- 对每个 Character 查 `latestState = findFirst({ orderBy: { fromChapterNumber: 'desc' } })`
- 合并 `{ ...c, status: latestState?.status || '{}', relationships: latestState?.relationships || '{}' }`
- 注入 preview / generate 的 prompt

被注入到 `charactersWithBranchState` 后,在 prompt 模板的「角色」层使用(具体见 `packages/prompt-runtime` 的角色层装配)。

### 0.4 死代码链路(本 spec 不修)

```
chapters-archive.ts:111 / :302 (latestBranchStates findMany + dedup)
  ↓
plot-arc-stage.ts:9-13 (声明为 PlotArcStageInput, 不读)
graph-extract-stage.ts:12 (声明为 GraphExtractStageInput, 不读)
  ↓
plot-consolidator.ts (grep: 无 branchState 引用)
graph-extract.prompt.ts (grep: 无 branchState 引用)
```

死代码是真实存在的,但**与本 spec 无关**——它是「即使写通了,plot-arc / graph-extract 也不会用」的另一回事。本 spec 只接 archive 写库,follow-up 任务负责清理死代码。

### 0.5 文件分工

| 文件 | 状态 | 角色 |
|------|------|------|
| `services/stages/character-stage.ts` | ✅ 在线 | 薄壳, 调 AI 输出 characterStates[] |
| `services/character-extractor.ts` | ❌ **不存在** | 准备新建, 写库函数 |
| `routes/chapters-archive.ts:archive` | ❌ **不写库** | `$transaction` 缺 CharacterBranchState |
| `routes/chapters-generate.ts:getCharactersWithLatestState` | ✅ 在线 | 真消费者, 读 CharacterBranchState |

---

## 1. 改动 1 — 接通 archive confirm 写 CharacterBranchState (P0)

### 1.1 改动点

**`routes/chapters-archive.ts`** — `archive` 端点:

```ts
// before
import { commitPlotArcWrites } from '../services/plot-extractor.js'
// ...
await prisma.$transaction(async (tx) => {
  for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
    await tx.memory.create({ data })
  }
  await commitPlotArcWrites(tx, chapter.number, plotArcs)
  await tx.chapter.update({ ... 翻 status: 'archived' ... })
})

// after
import { commitPlotArcWrites } from '../services/plot-extractor.js'
import { commitCharacterBranchStateWrites } from '../services/character-extractor.js'
// ...
await prisma.$transaction(async (tx) => {
  for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
    await tx.memory.create({ data })
  }
  await commitPlotArcWrites(tx, chapter.number, plotArcs)
  // 接通 v3 CharacterBranchState 写库 (P0): character-stage 输出 → CharacterBranchState 表
  await commitCharacterBranchStateWrites(tx, chapter.number, characterStates)
  await tx.chapter.update({ ... 翻 status: 'archived' ... })
})
```

### 1.2 注释更新

`routes/chapters-archive.ts:672` 把「备注: CharacterBranchState 写入另文档讨论,本端点不写」改为「备注: CharacterBranchState 已接通 (commitCharacterBranchStateWrites)。PlotArc 已接通 (commitPlotArcWrites)」。同时 L671 commit-only 描述加 `CharacterBranchState`。

### 1.3 提取 characterStates

跟 plotArcs 同一区域 (L602-603):

```ts
// character-stage 输出 (CharacterStateRow[]) — archive confirm 时落 CharacterBranchState 表
const characterStates: any[] = (pending.stages.character as any)?.result?.characterStates ?? []
```

注:`characterStates` 已是 `CharacterStateRow[]` 结构(`character-stage.ts:19-26`),字段直接可用:
- `characterId: string | null` — null 表示 isNew
- `name: string` — 用于日志
- `key: string` — 不用(Character 表的 slug 在 prepare-archive 已建)
- `status: string` — JSON 字符串(已是字符串格式,无需 stringify)
- `relationships: string` — JSON 字符串
- `isNew: boolean`

### 1.4 isNew=true 处理

**静默跳过 + 一行 log**。理由:
- Character 是手动 CRUD 模型(见 `routes/characters.ts:35` 的 Character 创建路径),archive 阶段无法 auto-create
- 跟 plot-arc "AI 输出有效就处理,无效就跳过" 风格保持一致
- 一行 `app.log.info` 让用户在 dev server 日志看到「AI 检测到新角色 X 但 Character 表没有该角色,跳过」,**不会阻塞归档流程**

具体实现见 §2。

### 1.5 失败处理

`commitCharacterBranchStateWrites` 内部**不 catch**:
- 任一 `tx.characterBranchState.create` 失败 → 异常向上冒泡
- `$transaction` 整体 rollback → 章节保持 `reviewing`,用户可重试
- **与 memory / PlotArc 写入失败行为一致**(无 silent swallow,遵循 `feedback_no_silent_errors`)

### 1.6 FK 约束边界 case

如果用户在 `prepare-archive` 后、`confirm` 前删除某 Character(`DELETE /api/characters/:id` 级联),对应 `characterId` 在 `tx.characterBranchState.create` 抛外键错 → 整事务回滚 → 章节保持 reviewing → 用户必须先重跑 character-stage 或编辑 `pendingArchiveData` 移除该 characterState 后重试。

这是符合「archive 失败可重试」原则的行为,**本 spec 不做特殊处理**。

### 1.7 验证手段

- **手动**: 用 87be28a9 ch1 准备 archive confirm 后再**回退到 reviewing**(通过 `prisma.chapter.update({status: 'draft', pendingArchiveData: ...})` 重新走 prepare-archive),确认后查 `CharacterBranchState`:
  - 应该出现 1 行 per matched character(2 行:姜禾、许青)
  - `fromChapterNumber = 1`
  - `status` / `relationships` 含 character-stage 输出 JSON
- **端到端**: archive confirm 章节前,CharacterBranchState 0 行非空;之后,2 行非空
- **跨章**: 第 2 章 generate 时,`getCharactersWithLatestState` 注入 prompt 的 `character.status` / `character.relationships` 不再是 `{}` fallback

---

## 2. 改动 2 — 新建 `commitCharacterBranchStateWrites`

### 2.1 文件位置

**`apps/server/src/services/character-extractor.ts`** — 镜像 `plot-extractor.ts` 结构(导出 1 个函数 + 类型)。

### 2.2 函数签名

```ts
import type { CharacterStateRow } from './stages/character-stage.js'

export async function commitCharacterBranchStateWrites(
  tx: any,
  chapterNumber: number,
  writes: CharacterStateRow[]
): Promise<void>
```

### 2.3 实现

```ts
import type { CharacterStateRow } from './stages/character-stage.js'

/**
 * 在事务中提交角色分支状态写入 (P0 fix: 修 v3 archive 不写 CharacterBranchState 表)
 *
 * 数据来源: character-stage 输出 characterStates[], AI 给出本章结束时
 * 每个 matched character 的 status / relationships JSON 字符串。
 *
 * 这里只负责把 writes 落到 CharacterBranchState 表:
 * - isNew=false + characterId 有效 → create 新 branchState 行, fromChapterNumber=本章号
 * - isNew=true 或 characterId=null → 跳过 (Character 是手动 CRUD 模型,
 *   AI 抽到新角色没有 Character 行可挂 branchState, 静默跳过 + 一行 log 让用户可见)
 *
 * 失败行为: 任一 create 抛错 → 异常向上冒泡, $transaction rollback,
 * 章节保持 reviewing, 用户可重试。
 */
export async function commitCharacterBranchStateWrites(
  tx: any,
  chapterNumber: number,
  writes: CharacterStateRow[]
): Promise<void> {
  for (const w of writes) {
    if (w.isNew || !w.characterId) {
      // Character 表里没有这个角色 (isNew=true 或 characterId=null),
      // 没法挂 branchState。静默跳过 + 一行 info log。
      // 不抛错: 用户可能在 reviewing 阶段手动删过 Character, 不该阻塞归档。
      tx.app?.log?.info?.(
        `[CharacterBranchState] skip isNew character: ${w.name} (no Character row to attach)`
      )
      continue
    }
    await tx.characterBranchState.create({
      data: {
        characterId: w.characterId,
        fromChapterNumber: chapterNumber,
        status: w.status,
        relationships: w.relationships
      }
    })
  }
}
```

### 2.4 关于 `tx.app?.log?.info?.()`

`tx` 是 Prisma 事务客户端,**没有 app 引用**。`app.log` 在 archive 处理器顶部有,需要传进来或用 `console.log` fallback。

更干净的写法 — 接受 `log` 作为可选参数:

```ts
export async function commitCharacterBranchStateWrites(
  tx: any,
  chapterNumber: number,
  writes: CharacterStateRow[],
  log?: { info: (msg: string) => void }
): Promise<void> {
  const safeLog = log ?? { info: (msg: string) => console.log(msg) }
  // ...
}
```

调用方:`chapters-archive.ts` 顶部已有 `app`,直接 `commitCharacterBranchStateWrites(tx, chapter.number, characterStates, app.log)`。

### 2.5 测试覆盖

**新文件 `apps/server/src/__tests__/services/character-extractor.test.ts`**(单元测试,~50 行):

- **happy path**: 3 条 writes (1 个 matched + 1 个 isNew + 1 个 null characterId) → create 被调 1 次(只 matched 那条),参数含 fromChapterNumber=chapterNumber
- **all isNew**: 2 条 writes (都是 isNew=true) → create 不被调
- **mixed**: 2 条 writes (1 matched + 1 isNew) → create 被调 1 次

mock 模式与 `plot-extractor.test.ts` 相同。

---

## 3. 改动 3 — 集成测试

### 3.1 新文件

**`apps/server/src/__tests__/routes/archive-character-branch-state-write.test.ts`** — 镜像 `archive-plot-arc-write.test.ts`:

- **happy path**: pendingArchiveData 含 characterStates=[2 matched characters] → archive confirm → `tx.characterBranchState.create` 调 2 次,参数含 `fromChapterNumber: chapter.number`
- **isNew skip**: characterStates 含 1 个 isNew=true → archive confirm 成功,`tx.characterBranchState.create` 只被调 1 次(matched 那条),章节翻 archived
- **rollback**: `tx.characterBranchState.create` 抛错 → 整个 `$transaction` 回滚,章节保持 reviewing

### 3.2 mock 模式

沿用 `createMockApp(mockPrisma)` + `callHandler` + `chapterArchiveRoutes(app)`。参考 `archive-plot-arc-write.test.ts` 已有写法。

### 3.3 测试覆盖目标

- 确认 `$transaction` 内 `commitCharacterBranchStateWrites` 被调
- 确认 isNew=true / characterId=null 时不调用 create
- 确认失败时 rollback 路径
- 章节状态正确翻转(archived / reviewing)

---

## 4. 改动 4 — LOGIC.md 同步

### 4.1 阶段 3 表格行 (L193)

**Before**:
```
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层 + PlotArc (`commitPlotArcWrites`) + Chapter.summary + Chapter 三列 + 翻 status（CharacterBranchState 写入另文档） |
```

**After**:
```
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层 + PlotArc (`commitPlotArcWrites`) + CharacterBranchState (`commitCharacterBranchStateWrites`) + Chapter.summary + Chapter 三列 + 翻 status |
```

### 4.2 阶段 3 编号列表 (L198-203)

在 step 2 (PlotArc) 后插入新 step 3 (CharacterBranchState),原 step 3 / step 4 顺延:

```
**阶段 3 当前实现**：`prisma.$transaction` 内依次写：
1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange 写入 `layer='chapter'`（mainEvent 多带 `'main-plot'` tag）；每条 scene 写 `layer='scene'`；每条 optimizer 融合记忆写 `layer='global'`（tag 加 `event` / `state'`）。
2. `tx.commitPlotArcWrites(chapter.number, pending.plotArcs)` 写 PlotArc 表（接 v3, 2026-07-30）：包含 consolidator 输出的 isNew / update / closed 写库、lastTouchedChapter 刷新、stale 自动检测、Jaccard 兜底（详见 `services/plot-extractor.ts` 与 `docs/superpowers/specs/2026-07-30-v3-plot-arc-write-design.md`）。
3. `tx.commitCharacterBranchStateWrites(chapter.number, pending.characterStates)` 写 CharacterBranchState 表（接 v3, 2026-07-31）：包含 character-stage 输出的 matched character 状态/关系, isNew=true 跳过 + log（详见 `services/character-extractor.ts` 与 `docs/superpowers/specs/2026-07-31-v3-character-branch-state-write-design.md`）。
4. `tx.chapter.update({ summary })` 写 Chapter 摘要（不进 Memory 表）。
5. `tx.chapter.update({ chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null })`。

`TimelineEvent` 在 v3 删除，不再写。
```

(尾部"CharacterBranchState 写入不在本端点"这句话删除,因为现在已接通)

---

## 5. 不在范围内

- ❌ `latestBranchStates` 死代码清理(`chapters-archive.ts:111,302` 查到不读) — 单独任务
- ❌ Characters.vue UI `branchStates?.[0]` 无排序修 — 单独任务
- ❌ `CharacterBranchState.fromChapterNumber Float?` schema 类型评估 — 单独任务
- ❌ CharacterStage prompt 改写 — 后续若需要
- ❌ Character 自动创建(isNew=true 时) — UX 上让用户主动管理 Character,避免 AI 自动创建产生重复/垃圾

---

## 6. 风险与回滚

### 风险

1. **FK 约束边界 case**(§1.6):用户在 prepare-archive 后、confirm 前删除某 Character → archive 失败 → 章节保持 reviewing → 用户必须重跑 character-stage 或编辑 pendingArchiveData。**预期行为,不修**。
2. **`status` / `relationships` 字符串形状**:character-stage prompt 强制要求 JSON object 字符串,但实际 AI 可能输出不合法 JSON。**当前不验证** — 若 create 抛错,事务回滚,章节保持 reviewing,用户可在 ReviewingPanel 编辑。这是「user-editable」原则的体现。
3. **死代码 `latestBranchStates` 链路**(§0.4):本 spec 接通后,即使 CharacterBranchState 有数据,plot-arc-stage / graph-extract-stage 也不会读。**这是预期** — 它们的下游消费没接通。后续单独任务清理。

### 回滚

`commitCharacterBranchStateWrites` 调用是单 line 改动,回滚 = 删这一行 + 注释回退。`character-extractor.ts` 内部不动,完全可逆。

---

## 7. 验证清单

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm --filter server test character-extractor` 全绿 (新单元测试)
- [ ] `pnpm --filter server test archive-character-branch-state-write` 全绿 (新集成测试)
- [ ] `pnpm --filter server test` 全绿,无回归
- [ ] `pnpm test` (server + web) 全绿
- [ ] 87be28a9 ch1 (回退到 reviewing 后重走 archive confirm) → `CharacterBranchState` 表查 ≥ 2 行(姜禾 + 许青), `fromChapterNumber=1`
- [ ] `docs/LOGIC.md` 阶段 3 描述同步更新
- [ ] 3 个 commit: 1 spec 落档 + 1 test + 1 fix + 1 docs(LOGIC)