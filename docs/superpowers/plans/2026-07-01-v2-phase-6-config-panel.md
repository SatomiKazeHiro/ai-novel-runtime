# Phase 6: 配置面板 + 收尾

> 基于 spec `2026-06-29-v2-overall-design.md`，Phase 6 是 V2 重建的最后一个阶段。

**Goal:** 将 V2ChapterDesign 右侧的只读配置摘要替换为可交互的勾选面板，让作者手动选择参与 prompt 组装的数据源。

**前置状态:** Phase 0-5 已完成，typecheck 通过。

---

## 当前状态

### 已完成（Phase 0-5）

| Phase | 内容 | 状态 |
|-------|------|------|
| 0 | Prisma V2 表 + routes-v2 骨架 + 前端路由 + api-v2 封装 | ✓ |
| 1 | V2Character CRUD + V2CharacterSnapshot 查询 | ✓ |
| 2 | V2Memory 查询 + 临时记忆 CRUD | ✓ |
| 3 | V2PlotArc 查询 + 状态筛选 | ✓ |
| 4 | V2Chapter CRUD + 配置保存 + SSE 生成 + 5 路分析 + 归档 | ✓ |
| 5 | Timeline/Graph 空接口 + Lore/WorkerTasks/PromptLogs 平移 + ChapterReader | ✓ |

### 待完成（Phase 6）

- [ ] 配置面板从只读摘要变为可交互勾选列表
- [ ] 4 类数据源各自展开，显示具体条目 + 复选框
- [ ] 保存配置后更新 prompt
- [ ] 全流程联调测试

---

## 当前配置逻辑（config-defaults.ts）

```typescript
// POST /chapters/:chapterId/config → getDefaultConfig(prisma, storyId)
{
  characterIds:  // V2Character 全部（有内容时自动勾选）
  memoryTypeIds: // V2Memory 中 global + temporary + isActive（默认勾选）
  plotArcIds:    // V2PlotArc 中 active + interrupted（默认勾选）
  loreIds:       // []（空，不选世界观）
}
```

## Phase 6 要做的

### 1. 配置面板 UI

当前右侧栏的配置区：
```
┌─ Prompt 配置 ─────────────────┐
│ 角色        3 个              │  ← 只读摘要
│ 记忆        5 条              │
│ 剧情弧线    2 条              │
│ 世界观      0 条              │
└──────────────────────────────┘
```

改为可展开的勾选面板：
```
┌─ Prompt 配置 ─────────────────┐
│ ▼ 角色 (3/3)                 │
│   ☑ 林帆 (主角)              │
│   ☑ 苏晴                     │
│   ☐ 张伟                     │
│                              │
│ ▼ 记忆 (5/8)                 │
│   全局                       │
│   ☑ 林帆与苏晴的关系变化     │
│   ☑ 上古遗迹的秘密           │
│   临时                       │
│   ☑ 本章要引出新角色         │
│   ☐ ...                      │
│                              │
│ ▼ 剧情弧线 (2/4)             │
│   ☑ 主线：林帆的成长 [活跃]  │
│   ☑ 支线：遗迹探索 [中断]    │
│   ☐ 支线：宗门斗争 [活跃]    │
│                              │
│ ▶ 世界观 (0) — 收起          │
│                              │
│ [保存配置]                    │
└──────────────────────────────┘
```

### 2. 默认勾选逻辑

| 数据源 | 默认勾选 | 理由 |
|--------|----------|------|
| 角色 | 全部 | 有角色时自动加载到 prompt |
| 记忆 | global + temporary（isActive） | 全局记忆是跨章累积的浓缩信息，临时记忆是作者指定的本章必选 |
| 剧情弧线 | active + interrupted | 活跃中的弧线需要推进，中断的也需作者看到 |
| 世界观 | 全部有内容的 | 世界观条目少，全选让 AI 了解世界设定 |

### 3. 保存机制

- 点击"保存配置" → PUT `/chapters/:chapterId` { config: newConfig }
- 保存成功后更新 chapter.config
- prompt 自动用新配置（生成候选时读取最新 config）

### 4. 需要新增/修改的东西

**后端：**
- 可能需要新增一个 GET 端点，返回所有可用数据源（角色列表、记忆列表、弧线列表、世界观列表），避免前端多次请求
- 或者直接复用已有端点：`GET /characters`, `GET /memories`, `GET /plot-arcs`, `GET /lore`

**前端：**
- 修改 V2ChapterDesign.vue 右栏配置区
- 新增可展开面板组件（或直接用 Naive UI NCollapse）
- 每个数据源加载全量选项，用 checkbox 控制选中

---

## V2 完整操作流程（供 Phase 6 讨论参考）

```
角色管理 ─┐
记忆模块 ─┤
剧情弧线 ─┼──→ [配置] ──→ [Prompt 组装] ──→ [AI 生成候选] ──→ [正文]
世界观   ─┘                                                    │
                                                               ↓
[阅读] ←── [归档] ←── [分析] ←──────────────────────────── [草稿保存]
              │
              └──→ 写入：角色快照 / 记忆 / 弧线更新 / 中断检测
```

### 流程步骤详解

1. **进入章节工作台** — V2Chapters.vue → 点击"设计" → V2ChapterDesign.vue 加载章节详情、候选列表、分析结果
2. **配置（当前自动）** — 硬编码 getDefaultConfig → 写入 chapter.config JSON
3. **生成候选文章** — SSE 流式，prompt 按 config 中的 ID 查 DB 拼装
4. **正文保存** — textarea 直接输入或从候选中选择，保存后生成 SHA256 hash
5. **分析** — 5 个独立 AI 调用（角色/记忆/弧线/时间线/图谱，后两者空实现）
6. **归档** — pre-archive 检查 → archive 事务写入（角色快照/记忆/弧线更新/中断检测）
7. **阅读** — 左侧归档章节列表 + 右侧正文阅读

---

## 不在本 Phase 范围内的（spec "不做的"）

- 旧数据迁移到新表
- 评分系统（v1 score 维度）
- 图谱/时间线的 AI 提取实现
- 处处兜底（逐个讨论后决定）
