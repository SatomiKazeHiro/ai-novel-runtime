# Questions for the project owner

> AI 编写代码时可能与你的设计意图漂移的点。每条：`#N | file:line | 现象 | 我猜你想要 X | 证据 | 影响范围`。
> `[speculative]` 标记 = 没有硬证据，凭感觉。
> 顺序：按"我对你的设计意图确定性低→高"——最不确定的放最前。

---

#1 | packages/shared/src/index.ts:3-10 | `ChapterStatus` const 只 6 个值（draft/generated/scored/selected/archived/rejected），缺 `generating` + `reviewing` | 我猜你想要 shared 与 Prisma enum 完全一致，前后端共用一份枚举 | Prisma schema 的 `ChapterStatus` 是 8 个值；前端 `Chapters.vue:1057` 的 `statusTagType` 也用 6 个值缺 `scored` + `rejected`；没有任何 import shared const 校验状态的代码 | 三层定义全不一致，改 schema 加新状态时要同步改 3 处，容易漏

#2 | prisma/schema.prisma:163 vs combined-extractor.ts:91-101 | `Memory.importance` 范围 1-10，但 `extractAll` prompt 让 AI 输出 4-7（主角+1=5-8） | 我猜你想要 schema 范围是"完整 1-10"，AI prompt 范围是"让 AI 保守打分避免噪声" | schema `@default(5)`、前端 `ReviewingPanel.vue:22` 的 `n-input-number :min="1" :max="10"` 用了 1-10；prompt 文案明确说"4~7，主角+1" | 用户手编辑可能填 1-10，但 AI 提取的永远是 4-8，跨章 importance 分布偏态

#3 | apps/server/src/routes/chapters.ts:29-37 | `assertStatusTransition` helper 定义后**没有任何路由调用** | 我猜你想要"集中校验状态转换合法性"，但没接上 | `VALID_STATUS_TRANSITIONS` 紧贴定义但只用于查表；所有路由（line 388, 517, 551, 630）用 `chapter.status === 'xxx'` 硬编码字符串判断 | helper 是死代码，但状态机本身靠 Prisma enum + 硬编码字符串工作（不出 bug 也没用上）

#4 | apps/web/src/views/ReviewingPanel.vue:454-465 | `buildData` 给**所有** memory 一刀切加 `user-edited` tag | 我猜你想要"用户编辑过的记忆打 user-edited 防止 AI 覆盖"，但 `isUserEdited` 应只在用户**实际改过**的 mem 上加 | line 458-463 `for (const mem of data.memories.memories) { if (!tags.includes('user-edited')) tags.push('user-edited') }`——没有"是否被改"的判断依据 | `memory-optimizer` 把整章都当 user-edited → 整章跳过 AI 融合 → **全局记忆优化失效**（这是 P0 但根因在 buildData 设计）

#5 | apps/web/src/composables/useChapterEditor.ts:150 | `JSON.parse(res.data.data)` —— 后端 `prepare-archive` 路由 (chapters.ts:610) 返回的 `data` 已是对象，前端又 parse 一次 | 我猜你想要"统一所有响应都 JSON.parse 一次防御"或"后端应返回 JSON 字符串" | line 150 在 try/catch 里，parse 失败吞掉置 null | `pendingArchiveData` 在前端为 null → `ReviewingPanel` 进不去 → 用户看到"未能加载归档审查数据"（前端崩溃路径，无 P0 危害但 UX 断片）

#6 | apps/web/src/views/ReviewingPanel.vue:167-183 vs apps/server/src/services/combined-extractor.ts:18-29 | `PendingArchiveData` interface 在前后端**各定义一份**，无共享 | 我猜你想要"前后端共享类型"但你目前没把 interface 提到 shared | 两个文件字段名/嵌套结构肉眼一致但 TS 不会校验——后端加字段、前端不改不会编译报错 | 改字段时容易漏改一边；字段漂移后用户 ReviewingPanel 看到数据缺字段

#7 | apps/server/src/routes/chapters.ts:585 | `prepare-archive` 调 `prepareArchiveData` **没有 try/catch**（与同文件 `archive` 路由 line 698-704 对 `optimizeMemories` 的处理形成对比） | 我猜你想要"prepare 阶段抛错让用户重试"或"准备阶段也保护起来" | line 585 `const pending = await prepareArchiveData(...)` 直接 throw；line 591 `if (!pending)` 才处理 null；archive 路由 line 657 事务 + line 698 优化都有 try/catch | `organizeGraph` 失败时请求 500，前端 `prepareArchive` 收到错误，`status` 仍为 `selected`（因为 line 602-608 不会执行）—— 状态机暂时一致但 UX 断片

#8 | apps/server/src/routes/chapters.ts:524-527 | `select` 路由 `draft.findUnique` 不校验 `draft.chapterId === chapterId` | 我猜你想要"select API 严格属于单章"或"上层已校验所以路由层不重复" | line 524 `findUnique({ where: { id: body.draftId }, include: { chapter: true } })` 拿到 draft 后没检查 draft.chapterId | 任何 chapter 的 select 调用能选任何 draft（结合无认证，可被恶意改任意 draft 状态）

#9 | apps/server/src/routes/chapters.ts:432 | `body.compiledPrompt` 接受用户改过的 compiled 嵌套结构，**无 zod 校验** | 我猜你想要"用户在前端 preview 后改 prompt 再 generate 走原路"或"compiled 应由后端拼装" | line 432-439 接受 `customCompiled.systemMessage` + `userMessage` 直接组装，无结构校验；后端其他路由多数用 `as any` | 结构错时 500（不冒泡到用户的好错误信息），好的路径会绕过 PromptPipeline 直接用 raw string

#10 | apps/server/src/routes/chapters.ts:382-393 | `generate` 路由无"刚提交但 worker 未开始"的并发保护 | 我猜你想要"前端只允许在 status === 'draft' 时调"或"有 worker 去重" | line 382 校验 `status === 'generating' → 400`；但 `status === 'draft'` 时连续点击 2 次会创建 2 批 draft + 2 个 queue job | 用户双击"生成候选"导致 2× tokens 消耗 + 数据库脏数据（draft 表可能堆积）

---

*生成工具：见 `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md`。请逐条回复"Y 接受"或"N 改回原意/补说明"——我下一步会基于你的回复写 `ISSUES.md`（仅 P0 严格范畴）。*
