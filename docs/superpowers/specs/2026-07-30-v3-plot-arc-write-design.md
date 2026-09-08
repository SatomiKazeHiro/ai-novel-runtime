# v3 PlotArc 写库接通 + 清理 v2 残留

**Goal:** 修 v3 已知遗留 — `chapters-archive.ts:archive` 端点不写 PlotArc 表,导致 plot-consolidator 跨章融合不生效,在 v3 实质上只能"每次从零开始"。

**Scope:** 接通 archive confirm 端点 → 写 PlotArc 表;跑通后深入调查 `stale` / `lastTouchedChapter` / `similarToExistingIds` 3 字段实际使用情况,**决定是否清理**。

**Out of scope:** plot-arc AI prompt 改进 (用户原话 "质量较好,暂不动")。CharacterBranchState 写库 (CLAUDE.md 标记的独立项)。

---

## 0. 现状摘要

### 0.1 数据流

```
chapter 内容
  ↓ runPlotArcStage (stages/plot-arc-stage.ts)
  ↓ plot-consolidator (consolidatePlotArcs)
  ↓ PendingPlotArcWrite[] (AI 推进/新增/关闭/翻转)
  ↓ 写 pendingArchiveData.stages.plotArc.result.plotArcs ✅
  ↓
  ❌ [断开] commitPlotArcWrites(tx, writes) 无 production caller
  ↓ v3 archive confirm 端点的 prisma.$transaction 不写 PlotArc
  ↓
  ❌ PlotArc 表永远 0 行 (87be28a9 实证)
  ↓ 下一章 consolidator 读 existing = []
  ↓ 又是 isNew=true → 短命 arc,跨章融合不发生
```

### 0.2 文件分工

| 文件 | 状态 | 角色 |
|------|------|------|
| `services/stages/plot-arc-stage.ts` | ✅ 在线 | 薄壳, 取 existing + 调 consolidator |
| `services/plot-consolidator.ts` | ✅ 在线 | AI 读章节 + existing, 算出 PendingPlotArcWrite[] |
| `services/plot-extractor.ts:commitPlotArcWrites` | ❌ **无 caller** | 准备好的写库函数, 13 个 unit test 测他 |
| `services/plot-extractor.ts:getActivePlotArcs` | ✅ 在线 | 被 generation prompt 注入使用 |
| `routes/chapters-archive.ts:archive` | ❌ **不写库** | `$transaction` 只写 Memory + Chapter |

### 0.3 87be28a9 ch1 实证

- PlotArc 表: 0 行
- `pendingArchiveData.stages.plotArc.result.plotArcs` 1 条:
  - name `不速之客` (main, prog 10, currentStage "初遇冲突,建立初步信任")
  - 3 unresolved 悬念
  - 1 stage
- 一旦 ch1 archive confirm,这条数据**会留在 pendingArchiveData 里被 null 清掉**,PlotArc 表依旧 0 行

### 0.4 v2 残留字段 (用户原话 "先接通, 跑通后去深入调查")

```
similarToExistingIds   — Jaccard tag, UI 没人读 (grep 0 处消费)
lastTouchedChapter     — stale 检测依赖, 也是 stale 唯一的 source data
stale status           — 自动检测的目标状态, 注释里说 "v3 可能需要" 但当前永不发生
```

**当前 grep 收录**:
- `plot-extractor.ts` (写相关字段)
- `plot-extractor.test.ts` (13 个测试, 直接测这三个字段)
- `plot-consolidator.ts:79` (注释说明 stale 由代码自动设)
- `plot-consolidator.test.ts:574` (Zod 拒绝 'stale' 写入测试)
- `commitPlotArcWrites` 内部扫描 `status: { in: ['active', 'resolving'] }` (exclude stale/completed)

**没有任何 UI 文件 / generation prompt 消费这三个字段**。但用户要求接通写库后再深入调查 (用户在 production 跑一遍, 看用户实际使用) 再决定是否清理。

---

## 1. 改动 1 — 接通 archive confirm 写 PlotArc (P0)

### 1.1 改动点

**`routes/chapters-archive.ts`** — `archive` 端点 (line 669 附近):

```ts
// before
await prisma.$transaction(async (tx) => {
  for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
    await tx.memory.create({ data })
  }
  await tx.chapter.update({ ... 翻 status: 'archived' ... })
})

// after
import { commitPlotArcWrites } from '../services/plot-extractor.js'

await prisma.$transaction(async (tx) => {
  for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
    await tx.memory.create({ data })
  }
  // 接通 v3 PlotArc 写库 (修 P0 遗留): consolidator 输出 → PlotArc 表
  await commitPlotArcWrites(tx, chapter.number, pending.plotArcs)
  await tx.chapter.update({ ... 翻 status: 'archived' ... })
})
```

### 1.2 注释更新

`routes/chapters-archive.ts:668` 把"CharacterBranchState / PlotArc 写入另文档讨论,本端点不写" 改为 "PlotArc 写入已接通, 见 commitPlotArcWrites。CharacterBranchState 写入另文档讨论,本端点不写"。

同步更新 `docs/LOGIC.md:193` 与 `docs/LOGIC.md:203`:
- "阶段 3 当前实现" 列表追加 step 4: `tx.commitPlotArcWrites(chapter.number, pending.plotArcs)`
- 表 L193 备注: "CharacterBranchState 写入另文档"
- `LOGIC.md:203` 改 "CharacterBranchState 写入不在本端点 (用户单独做)"

### 1.3 失败处理

`commitPlotArcWrites` 内部 try/catch 包裹情况:
- 目前实现内部不 catch, 任一 `tx.plotArc.{create,update}` 失败 → 异常向上冒泡
- `$transaction` 整体 rollback → 章节保持 `reviewing`, 用户可重试 archive confirm
- **与 memory 写入失败行为一致** (无 silent swallow, 用户反馈 `feedback_no_silent_errors`)

**不需要改动 commitPlotArcWrites 内部**, 现有 13 个 unit test 覆盖 Jaccard / lastTouchedChapter / stale / closed 透传, 测试足够。

### 1.4 `pending.plotArcs` 字段来源

```
const data = JSON.parse(chapter.pendingArchiveData) as PendingArchiveDataV3
data.stages.plotArc.result.plotArcs  // 入参
```

`pendingArchiveData` 已 JSON.parse 在 `archive` 端点开头 (line 580 附近),`pending.plotArcs` 直接可用。

### 1.5 验证手段

- **手动**: 用 87be28a9 ch1 准备 archive confirm, 确认后查 PlotArc 表:
  - 应该出现 1 行 (`不速之客` main, progress 10, lastTouchedChapter=1)
- **端到端**: archive confirm 章节前, PlotArc 表 0 行; 之后, 1 行 - 2 行 (是否新建依 consolidator 输出)
- **跨章**: 第 2 章 prepare-archive 时, `getActivePlotArcs` 注入 prompt 字段应包含 ch1 创建的 arc,consolidator 读 existing = [ch1 弧线] 而非 []

---

## 2. 改动 2 — 测试覆盖

### 2.1 `chapters-archive.ts` archive 端点现有测试

查 `apps/server/src/__tests__/routes/`:
- `prepare-archive-v3.test.ts` 验证 `prepare-archive` 端点 (没 archive 端点)
- 没有 `archive.test.ts` 覆盖 PlotArc 写库

### 2.2 新增测试 — `apps/server/src/__tests__/routes/archive-plot-arc-write.test.ts`

**测试覆盖**:

1. **happy path**: pendingArchiveData 含 plotArcs=[1 main] → archive confirm → PlotArc 表 1 行 (`isNew: true` 路径)
2. **update existing**: pendingArchiveData 含 plotArcs=[mix(1 new + 1 update)] → archive confirm → tx.plotArc.create 调 1 次, tx.plotArc.update 调 1 次
3. **失败回滚**: pendingArchiveData 含 plotArcs 但 commitPlotArcWrites 抛错 → 整个 $transaction rollback, Chapter 仍 reviewing, Memory 也没写

**mock 模式**: `prepare-archive-v3.test.ts` 已有 prisma mock 模式可参考。需要补 `transaction` mock + `plotArc` mock。

### 2.3 vitest 现有 mock 模式

`apps/server/src/__tests__/prepare-archive-v3.test.ts:1-50` 已有 mock 模式参考 (vi.mock app.prisma)。新测试沿用。

---

## 3. 改动 3 — 跑通后深入调查 (后续 phase, 不在本 spec)

**触发条件**: 改动 1 + 2 落地, 用户在 production 跑 1-2 章归档后, 收集 lastTouchedChapter / similarToExistingIds / stale 在 PlotArc 表里的实际数据。

**调查任务**:
1. **lastTouchedChapter**: 实际值是否正确 (AI 推进时刷新, carry-forward 不刷)?
2. **similarToExistingIds**: 实际新建 arc 时是否频繁命中 Jaccard ≥ 0.7? 命中后是否真有 UI 价值?
3. **stale 自动检测**: 实际触发频次? 触发后是否用户感知有用 (例如 UI 提示 "这条弧线很久没推进了")?

**调查输出**:
- 数据样本 (archived chapter 数量 + 各字段 hit 率)
- 用户真实使用价值判断
- 决策: 保留 / 删字段 / 删逻辑

**不在本 spec 决定清理**, 因为 user 原话 "先看看再说"。

---

## 4. 不在范围内

- ❌ plot-arc AI prompt 改动 (用户原话 "质量较好")
- ❌ CharacterBranchState 写库 (CLAUDE.md 标记独立项)
- ❌ `getActivePlotArcs` 改动 (generation prompt 注入, 不在 archive confirm 路径)
- ❌ `commitPlotArcWrites` 内部逻辑简化 (用户要求先跑通)
- ❌ `plot-extractor.test.ts` 13 个测试清理 (caller 接通后, 这些测试仍有价值)

---

## 5. 风险与回滚

### 风险

1. **commitPlotArcWrites 触发的 stale 副作用**: 接通后, archive confirm 末尾会扫 active/resolving arc, 可能把那条 once-adv long-ago 弧线转 stale。
   - 影响: 用户感知到 arc 状态从 active → stale, 可能困惑
   - 缓解: 跑通后调查里会评估这个 UX 影响

2. **PlotArc 表雪崩**: 没清空过历史, 87be28a9 已经累积 chapters 0 行, 但其他故事可能有 v2 残留
   - 缓解: 不在改动 1 范围, 后续 phase 处理

### 回滚

`commitPlotArcWrites` 调用是单 line 改动, 回滚 = 删这一行。`plot-extractor.ts` 内部不动, 可逆。

---

## 6. 验证清单

- [ ] `pnpm --filter server typecheck` 全绿
- [ ] `pnpm --filter server test` 全绿 (含新增 archive-plot-arc-write.test.ts)
- [ ] 87be28a9 ch1 archive confirm 后, PlotArc 表查 = 1 行 (`不速之客`)
- [ ] ch1.01 (side story) 准备 archive 时, consolidator 收到的 existing 包含 ch1 那条 main arc
- [ ] `docs/LOGIC.md` 阶段 3 描述同步更新
- [ ] commit message 沿用现有风格: `fix(server): 接通 v3 archive confirm 写 PlotArc 表`
