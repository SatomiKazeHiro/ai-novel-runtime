# 角色管理重构 — 当前状态

## 业务背景

用户希望角色管理满足以下规则：

- 角色有基础表字段：标识、姓名、主角定位、身份、外貌、气质、性格、说话风格、关系、状态。
- 章节归档后生成快照：衣着、关系、状态。
- 编辑弹窗：

  - 新增角色：单栏，可编辑基础关系、基础状态。
  - 编辑且没有快照：单栏，可编辑基础关系、基础状态。
  - 编辑且有最新快照：左右布局，左侧基础信息，右侧只读快照关系、状态。

- 不允许快照回填基础表。
- Prompt 使用规则：

  - 有最新快照：使用快照关系、状态。
  - 没有快照：使用基础关系、基础状态。

- 删除归档章节：只删除对应快照，不修改基础表。

## 当前 Git 状态（已核对）

- 当前分支：`v2/state-machine`
- 当前 HEAD：`a697560 fix(generate): base character fields now consumed as prompt fallback when snapshot missing`
- 工作区状态：干净。
- 未跟踪文件：

  - `.claude/worktrees/`
  - `.codex-characters-wip.patch`
  - `docs/superpowers/specs/2026-08-07-character-management-redesign.md`
  - `docs/superpowers/plans/2026-08-07-character-management-redesign.md`
  - `CHARACTER-MANAGEMENT-STATUS.md`（本文件）

## 已完成

- 角色基础字段与章节快照数据结构。
- 后端角色展示接口：关系、状态、衣着按章节独立查询最新快照。
- Prompt fallback 逻辑：有快照用快照，无快照用基础关系、基础状态。
- `backfill-character-base` 一次性迁移脚本。
- 角色卡片 Grid 布局与章节快照展示。
- 角色编辑弹窗基础字段（标识、姓名、主角、身份、外貌、气质、性格、说话风格）。
- 后续 UI 提交 `a4a4433 / 0128ab9 / ce8fb6f / 13a942a` 已回退，工作区无遗留。

## 未完成

1. **基础/快照数据契约的前端修复**

   - `CharacterDisplayRow` 需要新增：

     - `baseRelationships`
     - `baseStatus`

   - 两个字段必须只来自 `Character` 基础表。
   - `relationships` / `status` 必须只来自快照。
   - 当前分支中尚未落地。

2. **回填问题最终核验**

   - 编辑弹窗读取基础字段，不读取快照值。
   - 保存时不能修改 `CharacterBranchState`。
   - 当前分支中尚未落地。

3. **编辑弹窗 UI**

   - 新增角色：单栏，可编辑基础关系、基础状态。
   - 编辑无快照：单栏，可编辑基础关系、基础状态。
   - 编辑有快照：左右布局，左侧隐藏基础关系、基础状态，右侧只读快照关系、状态。
   - 当前分支中尚未落地。

4. **验证**

   - `pnpm exec vite build`
   - `pnpm exec vue-tsc --noEmit`
   - 角色展示服务与路由测试
   - Prompt fallback 测试

5. **提交策略**

   - 不自动提交。
   - 不再整文件重写 `.vue`。
   - 只用精确补丁。
   - 由用户决定是否提交。
