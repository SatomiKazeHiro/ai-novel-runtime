# Q14 — V2 章节号自动分配 + 第一章守卫

> 日期: 2026-07-04
> 状态: 设计已确认（用户拍板选 D: B + 预留扩展）

## Context

V2 章节列表页（`apps/web/src/views-v2/V2Chapters.vue`）当前存在 2 个用户可见的设计债：

1. **重复第一章风险**：右上角 "+ 新建章节" 按钮始终可用，作者可在已有第 1 章（草稿/分析中）的情况下再点，弹窗允许填 number=1，结果后端 chapters.ts:57-63 拒绝并报错"第 1 章已存在"。体验糟。
2. **章节号应由程序控制**：当前弹窗给用户填 `<n-input-number>`，让作者承担数据完整性责任（跳号、填小数、填重复）。违反 V2 spec §1 "Runtime 守门"原则 — 数据完整性应交给 Runtime。

## Decisions

### D1: 弹窗去 input-number 字段
- 弹窗去掉章节号 form 字段，标题改为动态 `"新建第 N 章"`
- 用户只填标题；章节号由后端统一分配
- 弹窗下方提示文字："章节号 N 由系统自动分配，无需手动指定"

### D2: 右上角按钮禁用规则
- `hasPendingFirstChapter` = `chapters.some(c => c.number === 1 && c.status !== 'archived')`
- 为 true 时按钮 `:disabled` + `:title` 提示"第 1 章正在创作中，请先归档或删除它"
- 精准命中"避免 2 个第一章"，不破坏 V2 的"多章节并存草稿"灵活性

### D3: 后端抽 `allocateNextNumber` 服务（关键决策：选 D 而非 C）
- 选 D 而非 C（一次性加 schema 字段做完整树结构）：理由见 §扩展性
- 新建 `apps/server/src/services-v2/number-allocator.ts`
- 函数签名预留 `parentChapterId?` + `isSideStory?` 参数（未来 Q14-C 树结构扩展位）
- 当前唯一可达路径：主线 `max(number) + 1`，无章节时 = 1
- `isSideStory=true` 和 `parentChapterId` 两个分支抛错"待 Q14-C 扩展"

### D4: 后端 chapters.ts POST 调 allocateNextNumber
- 替换原内联 max+1 逻辑（L47-56 旧）
- 保留 `body.number !== undefined && body.number > 0` 兼容路径（防御性，其他端误传时仍工作）

## 扩展性（为什么选 D 不选 C）

V2 schema 当前 `V2Chapter` 无 `parentChapterId` / `isSideStory` 字段。Q14-C 实施树结构时需要：
1. schema 加字段 + migration
2. 替换 `allocateNextNumber` 内的 TODO stub 为真实实现
3. V2Chapters.vue 加"主线 / 番外"二选一弹窗模式
4. 后端 chapters.ts 校验 parentChapter 状态（已归档）

D 方案下，**Q14-C 不会推翻 Q14 的代码**，只是把预留的 TODO stub 替换为真实逻辑 + 加 schema 字段。

如果选 C 一次到位，scope 是：
- schema 变更（migration 风险）
- 4+ 文件改动（schema + migration + 后端 + 前端 + 后端 chapter-tree 端点）
- V2 不支持番外/多支线的需求尚未明确（用户当前未提出）

## Files Changed

### 新建
- `apps/server/src/services-v2/number-allocator.ts` (45 行)

### 修改
- `apps/server/src/routes-v2/chapters.ts` — POST handler 调 allocateNextNumber；+1 import
- `apps/web/src/views-v2/V2Chapters.vue` — 弹窗去 input-number + 标题动态 + 按钮 disabled + computed × 2

## Non-Goals

- 不实现番外 / side story（Q14-C 范围）
- 不实现"主线必须依序"硬约束（V2 保留多章节并存草稿的灵活性）
- 不改 V2Chapters.vue 表格列布局
- 不改 V1 章节页（V1 已有完整树结构，本次不动）

## 验证

### typecheck
```bash
pnpm typecheck
```
应全部通过。

### 手工 e2e（dev server）
1. 启动 `pnpm dev`
2. 打开 `http://localhost:5173/novel-design-v2/<storyId>/chapters`
3. 验证场景：
   - **无章节**：右上角按钮可用，弹窗标题"新建第 1 章"
   - **创建第 1 章草稿**：按钮变 disabled + tooltip "第 1 章正在创作中..."
   - **归档第 1 章**：按钮重新可用，弹窗"新建第 2 章"
   - **删除第 1 章**：按钮可用，弹窗"新建第 1 章"
   - **归档章节行的"发展"按钮**：仍可用，创建后跳转到下一章号设计页
4. **后端兼容路径**：手工 curl POST `/api/v2/chapters` 传 number=99 → 应创建成功（防御性分支未砍）

## 提交策略

单 commit:
```
refactor(v2): Q14 — 章节号自动分配 + 第一章守卫 + allocateNextNumber 服务

前端:
- V2Chapters.vue 弹窗去 input-number, 标题动态 "新建第 N 章"
- 右上角按钮 disabled: chapters.some(c => c.number === 1 && c.status !== 'archived') + tooltip
- handleCreate 不传 number, 由后端统一分配
- handleDevelop 同样移除显式 number, 依赖后端

后端:
- 新建 services-v2/number-allocator.ts: allocateNextNumber 函数
  - 当前仅主线分支 (max+1, 无章节=1)
  - 函数签名预留 parentChapterId/isSideStory 参数, 未来 Q14-C 树结构扩展
  - isSideStory/parentChapterId 模式抛错 "待 Q14-C 扩展"
- chapters.ts POST handler 调 allocateNextNumber
  - 保留 body.number 兼容分支 (防御性, 前端不再传)

Why 选 D 不选 C: 修当前 2 个真痛点 (重复第一章 + 用户填错 number),
不一次吃 C 的 scope (schema migration + 三入口 UI). Q14-C 实施时只
需扩 allocateNextNumber 函数 + 加 schema 字段, 不会推翻本次代码.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```