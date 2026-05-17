# Node.js AI Novel Runtime Architecture Spec V2

## 1. Project Overview

本项目是一个：

```txt
AI 小说工程化 Runtime 系统
```

目标不是：

```txt
让 AI 自动写小说
```

而是：

```txt
让用户可以稳定、高质量、可控地开发长篇小说
```

核心思想：

```txt
人类主导方向
AI负责生成
Runtime负责稳定
```

系统支持：

- 长篇小说工程化开发
- 多故事管理
- 世界观管理
- 人设管理
- 章节记忆
- 知识图谱
- AI 候选生成
- AI 目标评分
- 废案归档
- Prompt Middleware
- 多模型兼容
- 越狱 Prompt 配置
- 长上下文预算控制

---

# 2. 技术栈

## 2.1 Frontend

### Core

- Vue 3
- TypeScript
- Vite
- Pinia
- Vue Router

### UI

推荐：

- Element Plus

或者：

- Naive UI

推荐优先：

```txt
Naive UI
```

因为：

- 更现代
- 更适合复杂后台
- TS 支持更好
- 配置系统更舒服

---

## 2.2 Backend

### Core Runtime

- Node.js
- TypeScript
- Fastify

推荐：

```txt
Fastify
```

不要 Express。

原因：

- 更适合 Runtime
- 插件化更强
- 更快
- TypeScript 更舒服

---

## 2.3 Database

### 主数据库

推荐：

- PostgreSQL

原因：

- JSONB 很适合小说结构化数据
- 事务稳定
- 关系图适合
- 可扩展

---

### ORM

推荐：

- Prisma

原因：

- Type-safe
- AI 更容易生成代码
- Schema 更清晰

---

## 2.4 Cache

- Redis

用于：

- Prompt Cache
- Session
- Context Cache
- AI Queue
- 章节生成任务状态

---

## 2.5 Queue

推荐：

- BullMQ

用于：

- AI 生成任务
- AI 评分任务
- Memory 更新
- Knowledge Graph 更新
- 废案归档

---

## 2.6 Vector Database（可选）

V1 可先不做。

后期推荐：

- pgvector

用于：

- 记忆召回
- 相似剧情检索
- 废案复用
- 风格检索

---

## 2.7 Graph Engine

推荐：

- graphology

用于：

- 人物关系图
- 势力图
- 事件图
- 世界观图谱

前端可视化：

- Cytoscape.js

---

## 2.8 AI SDK

推荐统一封装：

```txt
/providers
```

支持：

- OpenAI
- Claude
- Gemini
- DeepSeek
- Qwen
- GLM
- Minimax
- Kimi

统一接口：

```ts
interface AIProvider {
  generate(): Promise<any>
  streamGenerate(): Promise<any>
  embedding(): Promise<any>
}
```

---

# 3. 项目结构

推荐 Monorepo：

```txt
/apps
  /web
  /server

/packages
  /shared
  /prompt-runtime
  /knowledge-graph
  /memory-engine
  /ai-provider
  /story-engine
  /scoring-engine
  /warning-engine
```

推荐：

- pnpm workspace

---

# 4. 核心系统设计

---

# 4.1 Story System

一个 Story 即一个小说工程。

结构：

```txt
Story
 ├─ 基础信息
 ├─ 世界观
 ├─ 人设
 ├─ 势力
 ├─ 功法
 ├─ 时间线
 ├─ 章节
 ├─ 章节记忆
 ├─ 全局记忆
 ├─ 知识图谱
 ├─ Prompt 配置
 └─ 废案库
```

---

# 4.2 Story Folder Structure

逻辑结构：

```txt
stories/
  my_story/
    story.json

    characters/
    factions/
    realms/
    items/
    techniques/

    chapters/
    drafts/

    memory/
      global/
      chapter/

    graph/

    prompts/

    timeline/
```

---

# 4.3 Character System

角色卡：

```yaml
id: linfan
name: 林凡

personality:
  - 冷静
  - 偏执
  - 慢热

speech_style:
  - 简短
  - 克制

relationships:
  suqingxue:
    type: 爱慕
    value: 78

status:
  realm: 筑基
  location: 青云宗
```

---

# 4.4 LoreBook System

用于管理：

- 世界观
- 境界
- 地图
- 功法
- 规则
- 势力
- 物品

要求：

```txt
结构化
```

不要：

```txt
大段自然语言
```

---

# 4.5 Timeline System

必须实现。

否则长篇会崩。

结构：

```yaml
Day_12:
  - 林凡突破筑基
  - 苏清雪离宗
```

用于：

- 时间校验
- 人物位置校验
- 剧情一致性

---

# 4.6 Chapter System

章节状态：

```txt
Draft
Generated
Scored
Selected
Archived
Rejected
```

章节包含：

```txt
章节内容
章节摘要
章节记忆
场景状态
评分
预警
关联事件
```

---

# 4.7 Draft System

废案不是垃圾。

废案是：

```txt
创意资产库
```

必须长期保存。

支持：

- 标签
- 检索
- AI 复用
- 情绪提取
- 桥段回收

---

# 5. Prompt Runtime System

核心理念：

```txt
Prompt 只是渲染层
状态管理才是真正核心
```

本系统必须采用：

```txt
Stateless Generation
```

即：

- 每次生成使用新的上下文
- Runtime 动态组装状态
- 不长期续聊天记录
- 不依赖 LLM 自己记忆

真正长期记忆必须保存在：

- Memory System
- Knowledge Graph
- Timeline
- Character State
- Scene State

而不是：

```txt
无限聊天记录
```

---

# 5.0 Runtime Philosophy

本系统本质上是：

```txt
状态驱动生成系统
```

而不是：

```txt
聊天驱动生成系统
```

生成流程：

```txt
用户输入章节目标
 ↓
Runtime 提取必要状态
 ↓
Prompt Assembler 动态编译 Prompt
 ↓
调用模型
 ↓
生成候选章节
 ↓
评分与校验
 ↓
用户选择
 ↓
更新状态系统
```

不要：

```txt
一直 append 聊天记录
```

因为会导致：

- Token 爆炸
- Prompt 污染
- 风格漂移
- 人设崩坏
- 上下文腐烂
- 稳定性下降

---

这是核心。

不要简单拼接 Prompt。

必须：

```txt
Prompt Middleware
```

---

# 5.1 Prompt Pipeline

```txt
Input
 ↓
System Prompt
 ↓
Jailbreak Prompt
 ↓
Story Context
 ↓
Character Context
 ↓
Lore Context
 ↓
Scene Context
 ↓
Memory Context
 ↓
Style Context
 ↓
Generation Instruction
 ↓
Model Adapter
 ↓
LLM
```

---

# 5.1 Runtime Prompt Profile System

不要采用：

```txt
/set
/request
```

这种交互式 Prompt 协议。

因为：

- API 成本高
- 多轮调用浪费 Token
- 容易污染上下文
- 不适合批量候选生成
- 不适合工业化 Runtime

正确做法：

```txt
配置式 Prompt Runtime
```

即：

- 用户配置 Prompt Profile
- Runtime 自动编译最终 Prompt
- 一次调用直接生成

---

# 5.1.1 Prompt Profile

例如：

```yaml
profile:
  name: frenesis_writer_v1

identity:
  frenesis

settings:
  language: CN
  uncensored: true
  repeat: false

speciality:
  writer

memory:
  session

style:
  oppressive
  emotional
  slowburn

system_instruction: |
  你是一个长篇小说写作助手。
```

---

# 5.1.2 Prompt Layer System

推荐采用 Layer 化。

```txt
Identity Layer
 ↓
Behavior Layer
 ↓
Jailbreak Layer
 ↓
Style Layer
 ↓
Story Layer
 ↓
Lore Layer
 ↓
Character Layer
 ↓
Scene Layer
 ↓
Memory Layer
 ↓
Output Layer
```

这样比：

```txt
巨大硬编码 Prompt
```

更稳定、更可维护。

---

# 5.2 Jailbreak Prompt System

用户可配置：

```yaml
jailbreak:
  enabled: true

  prompts:
    - aggressive_v1
    - roleplay_unlock
```

要求：

- 多 Prompt
- 可排序
- 可启停
- 可测试
- 可版本化

---

# 5.3 Prompt Assembler

负责：

- Token Budget
- Prompt 优先级
- 动态裁剪
- Prompt 去重
- Context 压缩

避免：

```txt
Prompt 无限膨胀
```

---

# 5.4 Model Adapter

不同模型需要不同 Prompt 风格。

例如：

```txt
Claude Prompt
Gemini Prompt
DS Prompt
```

统一：

```txt
Universal Prompt
```

然后编译。

---

# 5.5 Stateless Context Runtime

每次生成：

```txt
创建新的上下文
```

而不是：

```txt
延续旧聊天
```

Runtime 必须动态提取：

- 当前章节目标
- Scene State
- Relevant Memory
- Relevant Graph Nodes
- Character State
- Lore Context
- Timeline Context
- Style Context
- Runtime Prompt

然后：

```txt
动态组装 Prompt
```

---

# 5.5.1 Scene-level Context Reuse

允许：

```txt
同一个 Scene 内短期续上下文
```

用于：

- Refine
- Rewrite
- 对话润色
- 场景修正

但：

```txt
章节结束后必须切断上下文
```

然后：

```txt
更新状态系统
```

---

# 6. Memory System

---

# 6.1 Memory Layers

分层记忆：

```txt
Global Memory
Chapter Memory
Scene Memory
Temporary Memory
```

---

# 6.2 Global Memory

长期信息：

- 世界观
- 角色关系
- 长期目标
- 势力关系

---

# 6.3 Chapter Memory

记录：

- 本章发生事件
- 情绪变化
- 关系变化
- 新伏笔

---

# 6.4 Scene Memory

短期上下文：

- 当前地点
- 当前角色
- 当前情绪

---

# 6.5 Memory Update Pipeline

```txt
章节采用
 ↓
AI 总结
 ↓
Memory Extract
 ↓
更新 Memory
 ↓
更新 Timeline
 ↓
更新 Graph
```

---

# 7. Knowledge Graph System

这是长篇稳定核心。

---

# 7.1 Graph Types

## Character Graph

```txt
林凡 -> 爱慕 -> 苏清雪
```

---

## Faction Graph

```txt
青云宗 -> 敌对 -> 血魔宗
```

---

## Event Graph

```txt
灭门事件 -> 导致 -> 复仇
```

---

## Realm Graph

```txt
炼气 -> 筑基 -> 金丹
```

---

# 7.2 Graph Usage

用于：

- 一致性检查
- Prompt Context
- 关系追踪
- AI 检索
- 战力校验

---

# 8. Candidate Generation System

核心思想：

```txt
一次生成多个候选
```

不要：

```txt
单次生成即最终结果
```

---

# 8.1 Candidate Pipeline

```txt
用户输入章节大纲
 ↓
构建 Scene State
 ↓
提取相关记忆
 ↓
提取相关图谱
 ↓
Prompt Assembler
 ↓
生成多个候选
```

例如：

```txt
candidate_a
candidate_b
candidate_c
```

---

# 8.2 Sampling Strategy

支持：

```yaml
temperature:
  low
  medium
  high
```

不同候选使用不同参数。

---

# 9. Scoring Engine

评分系统核心：

```txt
目标拟合度评估
```

而不是：

```txt
文学审美评分
```

评分目标：

```txt
是否符合用户目标
```

例如：

- 文风是否接近目标
- 是否符合角色设定
- 是否包含必要内容
- 是否违反禁用规则
- 是否符合节奏要求
- 是否符合情绪目标

---

不要做：

```txt
文学审美评分
```

而是：

```txt
目标拟合度评分
```

---

# 9.1 Score Categories

```yaml
scores:
  style_similarity:
  lore_consistency:
  character_consistency:
  emotional_tension:
  pacing:
  prose_quality:
  forbidden_content_risk:
```

---

# 9.2 Rule-based Check

必须加入：

- 禁止词
- 世界观冲突
- 境界冲突
- 时间线冲突
- 人设冲突

---

# 9.3 AI-based Evaluation

AI 负责：

- 文风接近度
- 情绪强度
- 人设稳定性
- 节奏感

---

# 10. Warning System

非常重要。

---

# 10.1 Warning Types

## 人设崩坏

```txt
角色行为与设定不符
```

---

## 战力崩坏

```txt
境界不合理
```

---

## 时间线冲突

```txt
角色不应该出现在当前地点
```

---

## 世界观冲突

```txt
出现不存在设定
```

---

# 11. Scene Engine

Scene 是真正生成核心。

---

# 11.1 Scene State

```yaml
scene:
  location: 后山

present_characters:
  - 林凡
  - 苏清雪

mood:
  tension

goal:
  confession
```

---

# 11.2 Scene Pipeline

```txt
章节大纲
 ↓
拆分 Scene
 ↓
构建 Scene State
 ↓
生成
 ↓
更新 Scene State
```

---

# 12. API Design

---

# 12.1 Story APIs

```txt
GET    /stories
POST   /stories
GET    /stories/:id
PUT    /stories/:id
DELETE /stories/:id
```

---

# 12.2 Chapter APIs

```txt
POST /stories/:id/chapters/generate
POST /chapters/:id/score
POST /chapters/:id/select
POST /chapters/:id/archive
```

---

# 12.3 Graph APIs

```txt
GET /stories/:id/graph
```

---

# 12.4 Memory APIs

```txt
GET /stories/:id/memory
```

---

# 13. Frontend Pages

---

# 13.1 Story Dashboard

显示：

- 当前进度
- 时间线
- 最近章节
- 角色关系
- 预警

---

# 13.2 Chapter Workspace

核心页面。

包含：

- 大纲输入
- 候选生成
- AI评分
- 差异对比
- 最终采用

---

# 13.3 Character Manager

用于管理：

- 人设
- 关系
- 状态
- 境界

---

# 13.4 LoreBook Manager

用于：

- 世界观管理
- 功法管理
- 地图管理

---

# 13.5 Knowledge Graph Viewer

图谱可视化。

推荐：

- Cytoscape.js

---

# 13.6 Prompt Manager

支持：

- Jailbreak Prompt
- Style Prompt
- Story Prompt
- Prompt 测试
- Prompt 版本管理

---

# 14. Context Budget System

长篇核心。

必须实现。

---

# 14.1 Dynamic Budget

例如：

```yaml
context_budget:
  total: 64000

  story_memory: 12000
  chapter_memory: 8000
  lore: 10000
  scene: 12000
  prompt: 6000
  output: 16000
```

---

# 14.2 Context Compression

支持：

- 摘要压缩
- Memory Merge
- Scene Summarization

---

# 15. Task Queue System

不要同步生成。

必须 Queue。

---

# 15.1 Queue Tasks

```txt
Generate Chapter
Score Chapter
Update Memory
Update Graph
Archive Draft
```

---

# 16. Future Extensions

V1 不建议做。

---

# 16.1 Multi-Agent

后期再考虑。

---

# 16.2 Autonomous Planning

后期再考虑。

---

# 16.3 Prompt Marketplace

后期再考虑。

---

# 16.4 Online Community

后期再考虑。

---

# 16.5 AI Fine-tuning

后期再考虑。

---

# 17. V1 Priority

V1 必须先完成：

```txt
Story System
Prompt Runtime
LoreBook
Character System
Chapter Generation
Candidate Sampling
Scoring Engine
Memory System
Knowledge Graph
Warning System
Context Budget
```

不要扩张。

先验证：

```txt
能否稳定写完一本长篇小说
```

这是 V1 最重要目标。

---

# 18. Architecture Philosophy

本项目核心思想：

```txt
结构化世界 + AI生成
```

而不是：

```txt
巨大Prompt + 无限Agent
```

真正重要的是：

- 状态管理
- 记忆管理
- 世界观一致性
- 长篇稳定性
- 章节工业化

AI 只是：

```txt
文本生成器
```

Runtime 才是真正核心。

