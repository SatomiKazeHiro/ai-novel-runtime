# 角色快照编辑（Character Snapshot Editing）设计

日期：2026-08-13
状态：设计已与用户确认，待实现

## 背景与动机

v4 角色管理重构（base/snapshot 分离）后，章节快照是**只读**的：归档时 AI 抽取的角色状态（`status` / `relationships` / `costume`）写入 `CharacterBranchState`，用户只能在角色页查看。

由此产生"快照纠错窗口"问题：归档后若 AI 抽取有误（角色位置误判、关系写错等），用户**没有任何纠正入口**——唯一路径是删除章节重跑归档（重跑 AI 抽取，结果不可控）。

**用户决策**：手动修改快照由用户自己负责。允许编辑已归档快照，并在编辑处做 UI 提醒。

## 现状（已调研确认）

- `CharacterBranchState`：每角色每归档章一行，`@@index([characterId, fromChapterNumber])`。**应用层状态机保证每章恰一行**：`prepare-archive` 仅允许 `draft`/`reviewing`（`chapters-archive.ts:59`）、`PUT /chapters/:id` 禁止改 status（`chapters-crud.ts:97`）、cancel/confirm 均仅限 `reviewing`。因此不存在同章重复归档（曾疑为 bug，调研后排除）。
- 读路径：
  - `fetchCharacterDisplay`（`services/character-display.ts`）— 角色页列表 + 单角色快照 GET 端点
  - `getCharactersWithLatestState`（`chapters-generate.ts:38`）— generate prompt 注入，每角色 `findFirst` 按 `fromChapterNumber` desc 取最新快照，无快照回退 base
- 消费无缓存：generate 每次现查数据库，编辑后**立即生效**。
- 现有 UI：`Characters.vue` 编辑弹窗右侧 aside 只读展示快照 + 章节选择器（`snapshotChapter`）。
- `ReviewingPanel` 编辑的是**未落库**的 `pendingArchiveData`（reviewing 阶段），本功能编辑的是**已归档**快照——阶段互斥，无冲突。

## 设计

### 后端：新增快照编辑端点

`PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber`

- **请求 body（全量三字段）**：
  ```json
  {
    "status": { "realm": "练气", "location": "青云山" },
    "relationships": { "林帆": "师徒" },
    "costume": "青衫"            // 或 null = 清空衣着
  }
  ```
- **校验**：
  - `charId` 存在且属于 `storyId`，否则 404
  - `status` / `relationships` 必须为 JSON 对象（null 也允许，表示清空），数组/字符串 → 400
- **实现**：`prisma.characterBranchState.updateMany({ where: { characterId, fromChapterNumber: chapterNumber }, data: { status: JSON.stringify(...), relationships: JSON.stringify(...), costume } })` — 幂等；`count === 0` → 404「该章节无此角色快照」
- **costume 语义**：空白字符串 → 存 `null`（与归档时"空串视同未描写"一致，`character-extractor.ts:112`）
- **不做章节存在性/archived 校验**：删章已级联删行（`chapters-crud.ts:188`），不存在的章自然 404
- **注册位置**：`apps/server/src/routes/characters.ts` 现有 `characterRoutes` 内，与 display/snapshot GET 端点同族
- **响应**：`{ success: true, data: { updated: 1 } }` / `{ success: false, error }`

### 前端：编辑弹窗 aside 增加编辑态

`apps/web/src/views/Characters.vue`

- 新增 `snapshotEditing` ref；aside 顶部加「编辑快照」/「取消编辑」切换按钮
- **编辑态**：
  - 顶部 `n-alert type="warning"`：**「手动修改快照由你负责。该快照将直接作为后续章节生成时的角色参考；删除对应章节时此修改随快照一并删除。」**
  - 章节选择器（已有 `snapshotChapter`）即"编辑目标章"，默认当前选中章
  - `status` / `relationships`：JSON textarea，预填当前值（`JSON.stringify(value, null, 2)`），保存前 `JSON.parse` 校验，失败提示（复用 base 表单同款交互）
  - `costume`：文本输入
  - 「保存快照」→ PUT → 成功后退出编辑态 + 重新拉取快照与列表
- **只读态**：与现状一致，无变化
- 前端 API 层：`charactersApi.updateSnapshot(storyId, charId, chapter, data)`

### 边界与语义

- **生效路径**：编辑 → `getCharactersWithLatestState` 下次 generate 读到编辑后值（无缓存）
- **回退语义不变**：删除章节 → 该章快照行删除 → 编辑随之消失；更早章快照/base 自然回退
- **支线快照同样可编辑**：`fromChapterNumber` 为 Float（如 1.01），URL 参数解析为 JS Number 与 SQLite REAL 同为 IEEE754 double，匹配无精度风险
- **多快照并存正常**：角色出场 N 章即有 N 个快照行；生成第 M 章时取该角色最新快照（`findFirst` desc）——这是既有设计，本功能不改动

### 错误处理

| 场景 | 响应 |
|------|------|
| 角色不存在 / 不属于该 story | 404 |
| 该章无此角色快照 | 404「该章节无此角色快照」 |
| status/relationships 非法 JSON 类型 | 400 |
| 更新成功 | `{ success: true, data: { updated } }` |

### 测试策略

- **server（TDD，有测试传统）**：新端点测试 `apps/server/src/__tests__/routes/characters-snapshot-edit.test.ts`（或并入现有 characters-snapshot.test.ts）：
  - 成功更新三字段
  - costume 空白 → 存 null
  - 无快照章 → 404
  - charId 不属于 storyId → 404
  - status 为数组 → 400
  - 编辑后 `getCharactersWithLatestState` 读到新值（可选集成断言）
- **web**：无 Characters.vue 组件测试（现有 web 测试为 composables/adapter 层），前端改动靠 `vue-tsc` typecheck + 浏览器手工验证

## 数据流

```
角色页 → 编辑弹窗 → aside「编辑快照」→ 选章（默认最新快照章）
→ 改 status/relationships/costume → 保存
→ PUT /api/stories/:sid/characters/:cid/snapshot/:n → updateMany branchState
→ 下次 generate 该角色时 getCharactersWithLatestState 读到编辑后值
```
