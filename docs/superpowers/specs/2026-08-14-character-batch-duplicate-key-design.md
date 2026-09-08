# 归档角色批内重复 key 去重设计

日期：2026-08-14
状态：设计已与用户确认，待实现

## 背景与动机

归档 confirm 时，character-stage 抽取的 `characterStates`（AI 输出，prompt 约定「每个角色一条记录」）进入 `resolveAndCommitCharacterWrites` 做 slug+name 匹配，再写 `CharacterBranchState`。

AI 偶尔违反「每个角色一条记录」的约定，对同一角色重复输出两条记录。当前 resolve 阶段**只比对事务外查到的现有角色**（`allExistingCharacters`），不追踪本批 writes 里已出现过的 key，导致两类后果：

- **问题 A（新角色重复 → rollback）**：两个新角色同 slug（key 不在现有角色里）→ 都标 `isNew` → commit 时第二个 `tx.character.create({ slug })` 撞 `Character` 表 `@@unique([storyId, slug])` → 整个 `$transaction` rollback，归档失败。
- **问题 B（已有角色重复 → 脏数据）**：两条记录命中同一现有角色 → 都进 `effectiveWrites` → 写两条重复 `CharacterBranchState`（同 characterId + 同 fromChapterNumber），下游 `findFirst` / `pickJson` 取到哪条不确定。

## 定性

**是缺陷，不是有意设计。** 业务语义「一个角色一章一条快照」由 prompt 约定，后端应对违反约定的输入做防御（标 conflict 报错），而不是静默写入。现有 `slug_name_mismatch` / `missing_key` 已经是对「AI 输出错误」的防御，唯独漏了「批内重复 key」这一环。

## 设计原则

（用户强调）**该报错就报错，不兜底**：重复 key 是 AI 输出错误，必须显式标 conflict → 409 让用户在归档前纠正；不做静默去重 / 取第一条 / 合并。

## 设计

### 后端：resolve 批内 key 去重

`apps/server/src/services/character-extractor.ts` 的 `resolveAndCommitCharacterWrites`，在 key 非空校验之后、短路分支之前，插入批内去重：

```ts
const seenKeys = new Map<string, number>() // key -> 首次出现的 writeIndex
for (let i = 0; i < writes.length; i++) {
  const w = writes[i]
  if (!w.key || !w.key.trim()) {
    conflicts.push({ writeIndex: i, reason: 'missing_key', aiWrite: w })
    continue
  }
  if (seenKeys.has(w.key)) {
    conflicts.push({
      writeIndex: i,
      reason: 'batch_duplicate_key',
      duplicateOfWriteIndex: seenKeys.get(w.key),
      aiWrite: w
    })
    continue
  }
  seenKeys.set(w.key, i)
  // 原有短路分支 + slug 匹配逻辑不变
}
```

- 去重放在所有分支之前（含短路分支）：key 是角色身份标识，重复 key 即「AI 重复输出同一角色」，无论该条是否已被 ReviewingPanel 纠正。
- 空 key 不进 `seenKeys`（继续走 `missing_key`），互不干扰。
- 纯内存逻辑，`tx` 参数不参与，不影响 resolve 的纯函数性质。

### ConflictInfo 扩展

```ts
reason: 'missing_key' | 'slug_name_mismatch' | 'batch_duplicate_key'
duplicateOfWriteIndex?: number  // 仅 batch_duplicate_key，指向首次出现的 writeIndex
```

### 前端：ReviewingPanel 冲突横幅按 reason 分支

`apps/web/src/views/ReviewingPanel.vue`：

- `slug_name_mismatch` → 沿用现有文案（name/slug 与已有角色冲突）。
- `batch_duplicate_key` → 「AI 重复返回了 slug="{{ key }}"（name="{{ name }}"），与第 {{ duplicateOfWriteIndex + 1 }} 条重复，请删除重复项或改 key」。
- props `conflicts` 类型加 `duplicateOfWriteIndex?: number`。

### 报错机制（复用既有，不新增兜底）

`chapters-archive.ts` archive route 现有：`resolveAndCommitCharacterWrites` 返回 `conflicts`，`conflicts.length > 0` → 409 返回，`$transaction` 不执行。批内重复会进 `conflicts` → 409 → 整个归档不落库，用户处理完再归档。此机制与 `slug_name_mismatch` / `missing_key` 完全一致，是「批量收集、入口处一次 409 报错」，不存在静默丢弃或降级。

## 边界

- 三条以上重复 → 第 2、3 条都标 conflict（各自 `duplicateOfWriteIndex` 指向第 1 条）。
- 两个不同 key 但用户纠正指向同一 characterId → 不拦截（key 不同，属用户有意操作）。
- 空 key 与重复 key 混合 → 各自正确标 reason，互不串扰。

## 测试策略（TDD）

`apps/server/src/__tests__/services/character-extractor-resolve.test.ts` 增补：

- 批内两个新角色同 slug → 第一条 `isNew`、第二条 conflict(`batch_duplicate_key`)，`conflicts` 长 1 —— 覆盖**问题 A**。
- 批内两条同 key 命中现有角色 → 第一条 `effectiveWrites`、第二条 conflict —— 覆盖**问题 B**。
- 三条以上重复 → 第 2、3 条都标 conflict。
- 空 key 与重复 key 混合 → `missing_key` 与 `batch_duplicate_key` 各自正确、互不串扰。
- 现有用例（slug+name 匹配 / mismatch / isNew / 短路纠正）全部不回归。

## 数据流

```
character-stage 输出 characterStates（可能含重复 key）
→ resolveAndCommitCharacterWrites 批内去重
   - 首次 key → effectiveWrites（isNew 或命中 existing）
   - 重复 key → conflicts.push(batch_duplicate_key)
→ archive route：conflicts 非空 → 409（不落库）
→ ReviewingPanel 显示冲突横幅 → 用户删除重复项 / 改 key → 重新归档
```
