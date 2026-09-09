# 图谱抽取上下文增强（Graph Extract Context）设计

日期：2026-08-15
状态：设计已与用户确认，待实现

## 背景与动机

图谱抽取（`graph-extract-stage`）存在「同实体不同 key」的实体分裂问题（实际踩过：姜禾佩剑出现 `jianghe_peijian` / `jianghe_sword` 两个 key）。追根溯源，是抽取时**丢了三个信息**：

1. **edges 被丢弃**：`extractGraphNodes`（`chapters-archive.ts:16`）从 `prev.cumulativeGraph` 只提取 `nodes`（type/key/label），edges 直接丢弃。
2. **label 没进 prompt**：`prevCumulativeGraphNodes` 有 label，但 `graph-extract.prompt.ts` 的 keyList 只拼 `${type}:${key}`，label 被丢。
3. **关系结构全无**：AI 看到的是「`item:jianghe_peijian`」这种光 key，既不知道它是「盐帮佩剑」，更不知道「姜禾持有它」。

于是 AI 本章再看到「姜禾的剑」，没有任何信息帮它判断「这就是 jianghe_peijian」，只能另起 key。

## 核心设计

**抽取时给 AI 传「正文人名 + 其关联点（事件/物品）」的紧凑上下文**，让 AI 在源头复用已有 key，而不是事后归一化。

关键洞察：**人（character）名字稳定、正文直接出现、容易锚定**；事件/物品（event/item）label 是 AI 起的、容易漂移。用「稳定的名字 + 其关系」喂给 AI，AI 看到「姜禾持有盐帮佩剑」，本章再写「姜禾的剑」就会复用 `jianghe_peijian`。

## 改动

### 1. `extractGraphNodes` → `extractGraphContext`（提取 nodes + edges）

`apps/server/src/routes/chapters-archive.ts:16`：

```typescript
function extractGraphContext(raw: string | null | undefined): { nodes: any[]; edges: any[] } {
  const parsed = safeJsonParse<{ nodes?: any[]; edges?: any[] } | null>(raw, null)
  return { nodes: parsed?.nodes ?? [], edges: parsed?.edges ?? [] }
}
```

调用处（prepare-archive / retry-stage 的 `prevCumulativeGraphNodes = extractGraphNodes(...)`）改为提取 `{ nodes, edges }`。

### 2. graph-extract-stage 输入传 nodes + edges

`GraphExtractStageInput`（`graph-extract-stage.ts`）把 `prevCumulativeGraphNodes` 改为 `prevCumulativeGraph: { nodes: any[]; edges: any[] }`。

### 3. prompt 生成「实体 + 关系」紧凑上下文

`buildGraphExtractPrompt`（`graph-extract.prompt.ts`）：

- **预过滤**：只保留「正文 `content.includes(label)` 出现的人名」的节点，及其关联的边。
- **组织**：按「人」分组，输出 `人名(type:key): 关系-关联实体(type:key)、…` 的紧凑文本：

```
【已有实体及关系】（复用已有 key，不要重复提取）：
姜禾(character:jiang_he): 持有-盐帮佩剑(item:jianghe_peijian)、参与-姜禾穿越(event:jiang_he_chuan_yue)
许青(character:xu_qing): 参与-帮助姜禾适应现代(event:xxx)
```

- **token 控制**：紧凑文本，不用 JSON（呼应「字段名省 token」）。先全传、不设人数上限，观察 token 后再优化。

- **抽取范围约束（增量抽取）**：prompt 明确告诉 AI「本章图谱只抽取**新增**的实体和关系」——新人 / 新物品 / 新事件，或已有人物之间的新关系 / 新进展。如果本章只是延续前面剧情（无新增），不要为了「凑数」重复输出已有的实体/关系，少输出甚至输出空。本章图谱是「本章新增快照」，全局累积交给 cumulative-graph。

## 边界

- **人物预过滤**：只有「label 出现在正文」的人物才进上下文；事件/物品不直接预过滤（通过「关联的人」带出来）。
- **方向**：边无论方向（人→物 或 物→人），都组织成「人→关系→关联实体」的主视角，让 AI 以人理解。
- **空图谱**：prev 为空（首章）时，上下文为「（空，本章可自由起 key）」，与现状一致。

## 测试策略

- `extractGraphContext`：正确提取 nodes + edges（空 / 只有 nodes / 完整）。
- `buildGraphExtractPrompt`：预过滤只留正文出现的人名、按人组织关系、空图谱回退。
- 现有 graph-extract 测试不回归。

## 数据流

```
prev.cumulativeGraph（nodes + edges）
  → extractGraphContext 提取
  → 预过滤「正文出现的人名」
  → prompt 组织「人名 + 其关联点」紧凑上下文
  → AI 抽取本章图谱时复用已有 key（源头减少重复）
```
