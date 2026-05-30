# 计划功能记录

## 1. 知识图谱新增独立 Graph Prompt 层（计划中）

**背景**：当前 Prompt Pipeline 有 9 层（Style/Story/Lore/Character/Scene/Memory/Timeline/PlotArc/Output），知识图谱数据只在归档时提取保存，不参与生成时的 Prompt 组装。

**方案**：新增第 10 层 `Graph`，放在 Memory 之后、Timeline 之前：

```
 6. Memory     ← 事件流（语义检索）
 7. Graph      ← 关系网络（新增）
 8. Timeline   ← 时间线事件
 9. PlotArc    ← 活跃剧情弧线
10. Output     ← 生成指令
```

**Graph 层内容示例**：
```
【当前世界状态】
- 势力分布：青云宗(正道) ──[敌对]── 魔教(邪道)
- 角色关系：张三 ──[盟友]── 李四, 张三 ──[师徒]── 王五
- 关键物品：玄天剑(在张三手中), 传送阵(已激活)
- 地点状态：青云山(安全), 黑森林(危险)
```

**前置条件**：
- 完成分支驱动图谱改造（GraphNode/GraphEdge 增加 `branchName` 字段）
- 实时图谱支持按分支查询

**改动点**：
- `PromptPipeline` 新增 `graph` 输入参数
- `/preview` 和 `/generate` 路由中读取当前分支的 GraphNode/GraphEdge 数据
- 增加 Graph 层的 token 预算（建议 2000-4000 tokens）

---

## 2. 分支驱动知识图谱（待实现）

见前文讨论。Schema 增加 `branchName`，归档时按分支保存图谱，前端按分支展示实时图谱。

---

*记录时间：2026-05-30*
