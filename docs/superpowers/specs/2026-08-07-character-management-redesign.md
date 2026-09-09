# 角色管理重构 — Base + Snapshot 双层 + AI 提取自动入库

**Goal:** AI 抽取的新角色不再 silent skip,而是自动建 Character 行 + 写入 snapshot;新增 costumn 字段(衣着)用于快照记录;Code 层校验 isNew(取代单靠 AI 自报);UI 层提供纠正机制;Characters.vue 三列快照展示并支持章节切换;迁移脚本回填历史数据的 base 关系/状态。

**Scope:** 仅角色管理相关变更(Character 表 / CharacterBranchState 表 / characters 路由 / character-stage / character-extractor / ReviewingPanel / Characters.vue / 一次性迁移脚本)。

**Out of scope:**
- 生成 prompt 注入逻辑(`getCharactersWithLatestState`)— 严格不动
- 衣着作为 prompt 输入
- 跨章节权重快照
- slug 自动改写 / AI 自动重命名
- Characters.vue 表格的搜索/分页/列宽等无关优化
- 自动创建 Character 时 base 关系/状态的写入(留空,per 用户决策)

---

## 0. 现状摘要

### 0.1 数据模型

```
Character 基础表 (apps/server/prisma/schema.prisma)
  id, storyId, slug, name, protagonist
  personality / speechStyle / identity / appearance / temperament (JSON string[])
  -- 缺失: base relationships, base status (目前只在 snapshot 里)

CharacterBranchState 快照表
  characterId, fromChapterNumber (Float?)
  status (String JSON), relationships (String JSON)
  -- 缺失: costume
```

### 0.2 现有快照写入路径(2 条手动 + 1 条 AI)

| 位置 | 触发 | fromChapterNumber | 是否需要改 |
|---|---|---|---|
| `routes/characters.ts:35` POST | 手动创建角色,带 status/relationships | `null` (初始) | **改: base 写一份, branchState 不再写** |
| `routes/characters.ts:67` PUT | 手动更新,带 status/relationships | `body.fromChapterNumber ?? null` | 不动 |
| `services/character-extractor.ts:17` | AI 抽取 commit | 本章号 | **改: isNew=true 不再 skip,改为 CREATE Character + branchState** |

### 0.3 Characters.vue 当前展示逻辑

- 关系/状态 两列从 `branchStates?.[0]?.status / relationships` 读取(最新一条,按 desc 排序)
- 无切换、无 source 标注

### 0.4 ReviewingPanel 当前行为

- 每行可编辑/删除
- 无 slug/name 冲突检测
- 无 isNew 纠正入口

---

## 1. Schema 变更

### 1.1 字段新增

| 表 | 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|---|
| `Character` | `relationships` | `String?` (JSON) | `null` | 基础/初始关系;第 1 章或番外无 snapshot 时 fallback |
| `Character` | `status` | `String?` (JSON) | `null` | 基础/初始状态;同上 |
| `CharacterBranchState` | `costume` | `String?` (text) | `null` | 衣着快照;解耦实现,后续可整体移除 |

`costume` 用单文本(`String?`)而不是 JSON — 穿着是描述性短语,非结构化关系。便于一键移除。

### 1.2 迁移

新生成 `prisma/migrations/2026XXXXXXXXXX_add_character_base_state_and_costume/`:
- `ALTER TABLE Character ADD COLUMN relationships TEXT`
- `ALTER TABLE Character ADD COLUMN status TEXT`
- `ALTER TABLE CharacterBranchState ADD COLUMN costume TEXT`

**不**改任何已有列的默认值,保持向后兼容(旧数据 关系/状态 为 null,展示走 fallback)。

---

## 2. 改动 1 — `routes/characters.ts` POST 接受 base 关系/状态

### 2.1 改动点

```ts
// before (lines 24-44)
const character = await app.prisma.character.create({
  data: {
    storyId, slug: body.slug, name: body.name,
    protagonist: body.protagonist ?? false,
    personality: JSON.stringify(body.personality || []),
    // ...5 tag fields...
  }
})
if (body.status !== undefined || body.relationships !== undefined) {
  await app.prisma.characterBranchState.create({
    data: { characterId: character.id, fromChapterNumber: null,
      status: JSON.stringify(body.status || {}),
      relationships: JSON.stringify(body.relationships || {}) }
  })
}

// after
const character = await app.prisma.character.create({
  data: {
    storyId, slug: body.slug, name: body.name,
    protagonist: body.protagonist ?? false,
    personality: JSON.stringify(body.personality || []),
    // ...5 tag fields...
    relationships: body.relationships !== undefined ? JSON.stringify(body.relationships) : null,
    status: body.status !== undefined ? JSON.stringify(body.status) : null
    // 不再自动创建初始 branchState — base 已是初始值,branchState 只在 archive 时产生
  }
})
```

**理由:** base 已是初始值。创建初始 branchState(fromChapterNumber=null)冗余,会让 `getCharactersWithLatestState` 优先取到 null 而非 base,失去 fallback 语义。

### 2.2 PUT 行为
保留现有 `fromChapterNumber ?? null` 逻辑 — 不动。

---

## 3. 改动 2 — `services/stages/character-stage.ts` prompt 加 costume 字段

### 3.1 改动点

在 prompt 模板 `output` JSON 结构里加 `costume`(可选):

```ts
// before
【输出】JSON
{
  "characterStates": [
    { "characterId": ..., "name": ..., "key": ...,
      "status": {...}, "relationships": {...},
      "isNew": <true / false> }
  ]
}

// after
【输出】JSON
{
  "characterStates": [
    { "characterId": ..., "name": ..., "key": ...,
      "status": {...}, "relationships": {...},
      "costume": "<本章节结束时的衣着/服饰描述,无变化或未描写则留空字符串>",
      "isNew": <true / false> }
  ]
}
```

### 3.2 解析层

`CharacterStageResult.characterStates[]` 类型扩展,新增可选 `costume: string`。commit 时若 `costume` 非空字符串才写 branchState.costume;空字符串视同未描写,不写。

---

## 4. 改动 3 — Code 层 isNew 校验(slug + name 双匹配)

### 4.1 改动点 — `services/character-extractor.ts`

```ts
// 取代依赖 AI 自报 isNew 的逻辑;改为 code 层做 key+name 双校验
export async function resolveAndCommitCharacterWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: CharacterStateRow[],
  allExistingCharacters: Array<{ id: string; slug: string; name: string }>,
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<{ effectiveWrites: CharacterStateRow[]; conflicts: ConflictInfo[] }>
```

### 4.2 校验逻辑

```ts
for (let i = 0; i < writes.length; i++) {
  const w = writes[i]
  if (!w.key) {
    conflicts.push({ writeIndex: i, reason: 'missing_key' })
    continue
  }
  const existing = allExistingCharacters.find(c => c.slug === w.key)
  if (existing) {
    if (existing.name === w.name) {
      effectiveWrites.push({ ...w, characterId: existing.id, isNew: false })
    } else {
      conflicts.push({ writeIndex: i, reason: 'slug_name_mismatch',
        existingCharacter: existing, aiWrite: w })
    }
  } else {
    effectiveWrites.push({ ...w, characterId: null, isNew: true })
  }
}
return { effectiveWrites, conflicts }
```

### 4.3 错误传播

`resolveAndCommitCharacterWrites` 在有 conflicts 时**不抛错**(返回 conflicts 数组),由上层 route 决定如何提示用户。这是 ReviewingPanel 警告 + 用户纠正的入口。

---

## 5. 改动 4 — Archive commit 处理 isNew(1 个角色)

### 5.1 改动点 — `routes/chapters-archive.ts` 的 archive 端点

在 `$transaction` 内的 `commitCharacterBranchStateWrites` 调用前,接入 `resolveAndCommitCharacterWrites`:

```ts
await prisma.$transaction(async (tx) => {
  // ... 既有 memory / plotArc / graph / 3 列写入 ...
  const allExisting = await tx.character.findMany({
    where: { storyId: chapter.storyId },
    select: { id: true, slug: true, name: true }
  })
  const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(
    tx, chapter.storyId, chapter.number, pending.characterStates, allExisting
  )
  if (conflicts.length > 0) {
    throw new ConflictError(conflicts)  // 让上层 route 转为 409 + ReviewingPanel 警告
  }
  await commitCharacterBranchStateWrites(tx, chapter.number, effectiveWrites)
  // ...
})
```

### 5.2 isNew=true 时的 Character 自动创建

`commitCharacterBranchStateWrites` 内部增加 isNew 分支:

```ts
for (const w of writes) {
  let characterId = w.characterId
  if (w.isNew || !characterId) {
    // 自动创建 Character 行: slug=key, base 关系/状态 留空
    const newChar = await tx.character.create({
      data: {
        storyId, slug: w.key, name: w.name,
        protagonist: false,
        personality: '[]', speechStyle: '[]',
        identity: '[]', appearance: '[]', temperament: '[]',
        relationships: null, status: null
      }
    })
    characterId = newChar.id
  }
  await tx.characterBranchState.create({
    data: { characterId, fromChapterNumber: chapterNumber,
      status: typeof w.status === 'string' ? w.status : JSON.stringify(w.status),
      relationships: typeof w.relationships === 'string' ? w.relationships : JSON.stringify(w.relationships),
      costume: w.costume && w.costume.trim() ? w.costume : null }
  })
}
```

**`storyId` 来源:** 改动后 `commitCharacterBranchStateWrites` 签名加 `storyId: string` 参数(目前没有,从 route 传入)。

---

## 6. 改动 5 — ReviewingPanel 纠正 UI + 冲突警告

### 6.1 纠正下拉(per 行)

`apps/web/src/views/ReviewingPanel.vue` 的 characterStates 表格每行加 `<n-select>`:

```vue
<n-form-item v-if="state.isNew" label="纠正为已有角色">
  <n-select
    v-model:value="state.correctedCharacterId"
    :options="existingCharacterOptions"
    placeholder="如果这是已有角色,请选择"
    clearable
    @update:value="onCorrectCharacter(state, $event)"
  />
</n-form-item>
```

`onCorrectCharacter` 把 `characterId` 改成选中角色 + `isNew=false`。保存走既有 `toV4()` 路径,ReviewingPanel.vue 已支持编辑 `characterStates`。

### 6.2 冲突警告横幅

进入 archive commit 前(route 检查 conflicts):

```ts
// route 层检测后,如果有 conflicts → 返回 409 + payload { conflicts: [...] }
// 前端 axios interceptor 或 ReviewingPanel onMounted 检测 conflicts → 显示<n-alert type="error">
```

警告内容:
- 显示 AI 返回的 key 和 name
- 显示冲突的 existing character (slug + name)
- 提示用户去 ReviewingPanel 纠正(选已有 / 改 AI 返回的 key / 取消提交)

---

## 7. 改动 6 — Characters.vue 三列快照展示 + 章节切换

### 7.1 数据获取 — 新增 `apps/server/src/services/character-display.ts`

新增工具函数,封装三字段独立查"最新有数据归档章":

```ts
export interface CharacterDisplayRow {
  id: string
  name: string
  slug: string
  protagonist: boolean
  identity: string[]
  appearance: string[]
  temperament: string[]
  personality: string[]
  speechStyle: string[]
  // 三字段各带来源标注
  relationships: { value: Record<string, any>; sourceChapterNumber: number | null } | null
  status:      { value: Record<string, any>; sourceChapterNumber: number | null } | null
  costume:     { value: string;             sourceChapterNumber: number | null } | null
}

export async function fetchCharacterDisplay(
  prisma: PrismaClient,
  storyId: string,
  viewChapterNumber: number | null  // null = "最新有数据"默认模式
): Promise<CharacterDisplayRow[]>
```

**关键实现:**
- 一次 `findMany` 拉所有 Character(story 维度)
- 一次 `findMany` 拉所有 CharacterBranchState(`characterId in [...]`),客户端按 `viewChapterNumber` 过滤
- 客户端按 characterId 分组 + 按 fromChapterNumber desc 排序,每个字段独立取第一条非空
- 字段值都通过 `safeJsonParse` 还原

### 7.2 API 端点

`GET /api/stories/:storyId/characters/display?chapter=<number|null>`:
- `chapter=null`(默认)→ 三字段各自查最新有数据归档章
- `chapter=N` → 统一显示第 N 章数据,无则空

返回结构:`{ success: true, data: CharacterDisplayRow[] }`。

### 7.3 前端 — `apps/web/src/views/Characters.vue`

替换当前 `charactersApi.list` 调用为 `charactersApi.display(storyId, viewChapter)`。

表格顶部加章节选择器:
```vue
<n-space style="margin-bottom: 12px">
  <n-text>查看章节:</n-text>
  <n-select v-model:value="viewChapter" :options="chapterOptions" placeholder="最新有数据(默认)" clearable />
</n-space>
```

`chapterOptions` 从章节列表拉,包含所有 archived chapter,带 "第 N 章: {title}"。

三列单元格改为渲染 `{value}` + 来源标签:
```vue
<n-space vertical size="small">
  <span>{{ value }}</span>
  <n-tag v-if="sourceChapterNumber" size="tiny" type="info">来源: 第 {{ sourceChapterNumber }} 章</n-tag>
</n-space>
```

新增"快照"标识(避免用户误以为可改后直接影响下次生成):
- 列头加 `<n-tag size="tiny">(快照)</n-tag>`

**编辑行为:** 编辑 关系/状态/衣着 时走 PUT,append 新 branchState(`fromChapterNumber=null`,per 现状)。提示用户"该值将作为新分支入库,不会覆盖已有历史"。

---

## 8. 改动 7 — 迁移脚本 `scripts/backfill-character-base.ts`

### 8.1 改动点

新增一次性脚本。在已有 Character 数据的项目上,把每个角色最新一条 branchState 的 关系/状态 回填到 base。

### 8.2 实现

```ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const characters = await prisma.character.findMany()
  let updated = 0, skipped = 0
  await prisma.$transaction(async (tx) => {
    for (const c of characters) {
      const latest = await tx.characterBranchState.findFirst({
        where: { characterId: c.id },
        orderBy: { fromChapterNumber: 'desc' }
      })
      if (!latest) { skipped++; continue }
      await tx.character.update({
        where: { id: c.id },
        data: {
          relationships: latest.relationships,
          status: latest.status
        }
      })
      updated++
    }
  })
  console.log(`[backfill] updated=${updated}, skipped=${skipped}`)
}

main().finally(() => prisma.$disconnect())
```

### 8.3 调用方式

```bash
pnpm tsx scripts/backfill-character-base.ts
```

加 `package.json` script: `"db:backfill-character-base": "tsx scripts/backfill-character-base.ts"`。

**部署注意:** 一次性脚本,跑完即弃。不放进 CI。

---

## 9. 不在范围(YAGNI)

- ❌ 生成 prompt 注入逻辑优化 — 用户明确不动
- ❌ 衣着作为 prompt 输入 — 后续探讨,本 spec 不涉及
- ❌ 跨章节权重快照 — 用户明确否决
- ❌ slug 自动改写 / AI 自动重命名冲突
- ❌ Characters.vue 表格搜索/分页/列宽
- ❌ Characters.vue 编辑 modal 拆分 — 现有 modal 已够用,本次仅调字段
- ❌ base 关系/状态 的 edit UI — 暂由 character create 时设置 + migration backfill 维护
- ❌ 字符级 diff / 关系网络可视化(基于 snapshot 历史的演化图)— 独立项目

---

## 10. 风险与回滚

### 10.1 风险

1. **base + snapshot 双存储的 sync 问题:** base 仅由 migration / 手动 create / 不更新方式维护;用户若想"改初始状态"目前没有 UI(列入不在范围)。
   - **缓解:** 文档化;若有需求,加 base edit UI 是独立 spec。

2. **isNew 自动建 Character 的副作用:** AI 抽错(比如把路人识别成主角)会建一个真实 Character 行,无法批量删除(级联 branchState)。
   - **缓解:** ReviewingPanel 让用户删 isNew=true 行(已有删除按钮,扩展即可)→ commit 时 resolvelveAndCommitCharacterWrites 不处理该行 → 不建 Character,也不建 branchState。
   - **数据流:** 前端删行 = 不写入 pendingArchiveData.stages.character.result.characterStates,自然传到 commit 阶段被忽略。

3. **`commitCharacterBranchStateWrites` 签名变更:** 加 `storyId` 参数,现有调用方 4 处需要更新(route + tests)。
   - **缓解:** TypeScript 类型会标红,逐步修。

4. **Migration backfill 幂等性:** 重复跑会把 base 设回第一次跑时的"最新"值。
   - **缓解:** 一次性脚本;部署文档明示"只跑一次"。

5. **`character-display.ts` 三字段独立查在角色数 100+ 时有性能压力:** 一次 findMany 全量拉 + 客户端分组。
   - **缓解:** 当前角色量级不构成瓶颈;后续若优化,加 `?sinceChapterNumber` 限定范围。

### 10.2 回滚

按改动独立可回滚:
- Schema 加字段 → 反向 migration(`ALTER TABLE ... DROP COLUMN`)即可
- character-stage prompt 加 costume → 删 prompt 段 + 删 CharacterStageResult.costume 字段
- `commitCharacterBranchStateWrites` 改 isNew 行为 → 改回 skip + log
- Characters.vue 改用 display 端点 → 改回 charactersApi.list
- Migration backfill → 不需回滚,base 值可手动调

每个改动可单独 revert 而不影响其他。

---

## 11. 验证清单

### Schema
- [ ] `pnpm db:migrate` 在 dev (SQLite) 通过
- [ ] `pnpm db:generate` 不报 TS 错误
- [ ] Character 表新增 relationships / status 列,nullable
- [ ] CharacterBranchState 表新增 costume 列,nullable

### 后端
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm --filter server test` 全绿(尤其 `character-extractor.test.ts`)
- [ ] 新增单元测试 `services/character-display.test.ts`:`fetchCharacterDisplay` 三字段独立查行为
- [ ] 新增单元测试 `character-extractor`:isNew 解析 + slug+name 冲突检测
- [ ] 新增集成测试 `archive-confirm-character-auto-create`:新角色入库路径
- [ ] `scripts/backfill-character-base.ts` 在空库和有数据库各跑一次,验证幂等/报错

### 前端
- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm --filter web test`(若存在)全绿
- [ ] Characters.vue 三列展示"来源"标签,章节切换下拉可用
- [ ] ReviewingPanel 纠正下拉 isNew=true 时可见,选中后 characterId 更新
- [ ] 冲突警告横幅触发并显示清晰文案

### 端到端
- [ ] 手动跑一遍:创建角色(含 base 关系/状态)→ 归档章节含新角色 → 检查 Character 表多 1 行,CharacterBranchState 表多 1 行,base 关系/状态 为空
- [ ] 手动跑一遍:ReviewingPanel 纠正 isNew → archive commit → Character 表行数不变,branchState 多 1 行,characterId 指向已有
- [ ] 手动跑一遍:故意制造 slug+name 冲突 → 警告横幅出现 → 纠正后 commit 通过
- [ ] 手动跑一遍:migration backfill 在有数据的 fixture 库上,验证 base 关系/状态 被正确填充

### 文档
- [ ] `AGENTS.md` §9 功能速查表更新:角色管理行补 `character-display.ts` / `backfill-character-base.ts`
- [ ] `docs/LOGIC.md`(若有)阶段 3 描述同步更新

---

## 12. 改动文件清单

**后端**:
- `prisma/schema.prisma` + 新 migration
- `apps/server/src/routes/characters.ts`(POST 接受 base 关系/状态)
- `apps/server/src/services/stages/character-stage.ts`(prompt + 解析加 costume)
- `apps/server/src/services/character-extractor.ts`(新增 `resolveAndCommitCharacterWrites`,扩展 `commitCharacterBranchStateWrites`)
- `apps/server/src/services/character-display.ts`(新,三字段独立查)
- `apps/server/src/routes/chapters-archive.ts`(archive 端点接入新逻辑 + 冲突检测)
- `apps/server/src/routes/characters.ts`(新增 GET display 端点)
- `scripts/backfill-character-base.ts`(新)
- `package.json`(新增 db:backfill-character-base script)

**前端**:
- `apps/web/src/views/Characters.vue`(三列 + 来源 + 章节切换)
- `apps/web/src/views/ReviewingPanel.vue`(纠正下拉 + 冲突警告)
- `apps/web/src/api/characters.ts`(新增 display 端点类型)

**文档**:
- `AGENTS.md` §9 角色管理行