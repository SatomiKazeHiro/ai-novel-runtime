下面这份不是给人看的，而是**给 AI（包括 Claude Code、GPT Agent、Cursor、Gemini CLI 等）作为开发规范**看的，所以尽量采用工程化描述，而不是论文描述。

---

# AI Novel Engine - Timeline System Design Specification (v1)

## 1. Goal

设计一套适用于 AI 长篇小说生成的时间线系统。

目标：

* 支持百万字以上长篇小说
* 支持章节生成
* 支持章节归档
* 支持长期记忆
* 支持剧情回顾
* 支持自动检测时间矛盾
* 支持未来升级解析器而无需重新生成小说

时间系统不是为了记录"日期"，而是为了维护**事件之间的时间关系**。

---

# 2. Overall Architecture

```
Novel

├── Chapter
│      │
│      ▼
│  Chapter Archive
│      │
│      ├── Character Extractor
│      ├── Location Extractor
│      ├── Item Extractor
│      ├── World Extractor
│      ├── Event Extractor
│      ├── Plot Extractor
│      └── Timeline Extractor
│
└─────────────► Memory Database
                    │
                    ▼
             Next Chapter Generator
```

时间线属于 Archive 的一部分。

生成下一章时：

Memory Database

负责提供：

```
人物状态

剧情状态

最近事件

时间上下文

世界状态

```

供 AI 作为 Prompt。

---

# 3. Timeline Design Philosophy

不要保存：

```
第381天
```

不要保存：

```
2025-03-01
```

不要假设：

```
三个月 = 90天
```

不要强行解析：

```
很多年以后
```

应该保存：

```
事件之间的关系
```

即：

```
Event A

↓

三天后

↓

Event B
```

而不是：

```
Day0

↓

Day3
```

---

# 4. Core Objects

## Event

事件是整个系统唯一的时间主体。

每一个事件包含：

```
Event

id

chapter

title

summary

participants

location

importance

time

tags
```

例如：

```json
{
  "id":"event_001",

  "title":"李云拜师",

  "chapter":12,

  "participants":[
      "李云",
      "青玄真人"
  ],

  "location":"青玄宗",

  "importance":"major",

  "summary":"李云拜青玄真人为师"
}
```

---

# 5. Time Expression

不要立即解析时间。

保留原文。

例如：

```
三天后

半年后

当天夜里

第二纪元

世界树时代

很久以后

```

全部保存。

结构：

```json
{
    "raw":"三天后",

    "language":"zh",

    "type":"relative"
}
```

另一个例子：

```json
{
    "raw":"纪元前",

    "type":"era"
}
```

---

# 6. Time Reference

任何时间表达都应该有引用对象。

例如：

```
三天后
```

不是：

```
+3d
```

而是：

```
Reference

↓

上一事件
```

例如：

```json
"time":{

    "reference":"event_035",

    "expression":"三天后"

}
```

表示：

```
Event036

发生于

Event035

三天之后
```

---

# 7. Time Offset

Offset 是解析器的产物。

不是必须。

例如：

```json
{
    "value":3,

    "unit":"day"
}
```

如果无法解析：

```
多年以后
```

则：

```json
{
    "offset":null
}
```

不要猜。

---

# 8. Temporal Relation

真正重要的是关系。

例如：

```
EventA

↓

Before

↓

EventB
```

或者：

```
EventB

↓

After

↓

EventA

↓

3 days
```

推荐结构：

```json
{

    "from":"event001",

    "to":"event002",

    "relation":"after",

    "expression":"三天后",

    "offset":{

        "value":3,

        "unit":"day"

    }

}
```

---

# 9. Timeline

Timeline 不是数组。

应该是 Graph。

例如：

```
Main Timeline

│

├── Event001

│

├── Event002

│

└── Event003
```

支持：

```
Flashback

Dream

Parallel World

Future

```

因此：

```
Timeline

↓

Timeline Nodes

↓

Timeline Edges
```

而不是：

```
Day1

Day2

Day3

```

---

# 10. Timeline Anchor

一个小说可能拥有多个时间轴。

例如：

```
Present

Flashback

God Era

Second Era

Parallel World
```

因此需要：

```
Anchor
```

例如：

```
Anchor

id

name

description
```

例子：

```
anchor_present

anchor_flashback

anchor_era1

anchor_era2
```

---

# 11. Resolver Layer

增加独立解析器。

不要在 Extractor 内完成。

流程：

```
Chapter

↓

Event Extractor

↓

Time Expression Extractor

↓

Time Resolver

↓

Timeline Graph
```

职责：

Extractor：

只抽取。

Resolver：

建立关系。

---

# 12. Query Strategy

任何时候：

不要查询：

```
今天是多少天？
```

应该查询：

```
最近发生了哪些事件？

这些事件之间是什么关系？
```

例如：

```
最近三章

↓

事件

↓

时间关系

↓

作为 Prompt
```

---

# 13. Long-term Memory

Memory 不直接保存：

```
Day234
```

而保存：

```
Character Memory

World Memory

Location Memory

Event Memory

Timeline Graph
```

下一章生成：

Prompt：

```
当前事件

↓

最近事件

↓

相关人物

↓

相关地点

↓

Timeline Context
```

而不是：

```
整个时间线
```

---

# 14. Ambiguous Time Policy

对于：

```
多年以后

很久之后

后来

之后

数日

某一天

```

全部允许：

```json
{

    "raw":"很多年以后",

    "offset":null,

    "confidence":"low"

}
```

不要推测。

---

# 15. Era Policy

不要把：

```
第一纪元

第二纪元
```

解析成年份。

应该：

```
Era

↓

Era1

↓

Era2

↓

Era3
```

事件属于：

```
Era
```

即可。

---

# 16. Generation Strategy

下一章生成时：

只提供：

```
最近事件

+

关联人物

+

关联地点

+

Timeline Context

+

Plot Goal

+

未完成事件
```

不要把完整 Timeline 放进 Prompt。

---

# 17. Future Extensions

后续可增加：

## Timeline Validator

检测：

```
年龄错误

事件顺序错误

人物同时出现

时间倒流

死亡后再次出现

```

---

## Timeline Compression

长篇小说：

```
10000+

事件
```

自动聚合：

```
宗门时期

↓

帝国战争

↓

仙界时期
```

减少 Prompt。

---

## Timeline Visualization

生成：

```
Timeline Graph
```

供作者查看。

---

# 18. Core Principle（最高原则）

整个时间系统遵循以下原则：

1. **事件（Event）是核心，时间只是事件的属性，而不是独立主体。**
2. **保存原始时间表达（Time Expression），不要急于转换成绝对时间。**
3. **维护事件之间的时序关系，而不是维护"第 N 天"这样的全局计数。**
4. **所有可推导的数据（绝对日期、累计天数等）都在查询阶段动态计算，不在存储阶段固化。**
5. **允许模糊、不完整、未知的时间信息存在，不进行猜测。**
6. **时间线本质上是一个 Temporal Graph（时间关系图），而不是线性数组。**
7. **生成下一章时，只检索与当前剧情相关的时间上下文，而不是加载完整时间线。**

---

## 建议增加一个容易被忽略但收益极高的模块：Narrative Time（叙事时间）

最后补充一个很多 AI 小说项目一开始没有做，但后期几乎都会补上的设计：**区分「故事时间（Story Time）」和「叙事时间（Narrative Time）」**。

例如：

```
第50章
    ↓
主角回忆五年前
    ↓
回忆结束
    ↓
继续现在
```

故事时间实际上是：

```
现在 → 五年前 → 现在
```

但叙事顺序却是：

```
事件A → 回忆事件B → 回忆事件C → 返回事件D
```

因此建议 Event 再增加两个字段：

```json
{
  "story_order": 125,
  "narrative_order": 203
}
```

* **story_order**：事件在故事真实时间中的顺序。
* **narrative_order**：事件在小说章节中的出现顺序。

这样无论是回忆、插叙、倒叙、多线叙事还是平行世界，都能准确处理，而不会破坏主时间线。这一点对于长篇小说的稳定生成和后续矛盾检测，价值非常高。
