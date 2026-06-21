# Product Naming & Dashboard Copy Localization (中文化) — Design Spec

**Goal:** 把面向用户的品牌标识从英文 `AI Novel Runtime` 改为中文 `AI 小说工坊`, 并把 Dashboard 顶部英文文案 hero + eyebrow 改成中文, 让产品语言与功能 UI 一致(应用其他位置都是中文)。代码库内部标识 (`ai-novel-runtime` 包名 / 仓库名) 保留不变。

---

## 1. 现状

产品名"AI Novel Runtime"散落在 10 处,其中 6 处面向用户/平台标识,5 处是工程文档标题:

**面向用户 (6 处):**
- `apps/web/src/components/NavBar.vue:15` — NavBar brand 文字 `AI Novel Runtime`
- `apps/web/src/components/NavBar.vue:47` — about dropdown 标题 `AI Novel Runtime v0.1.0`
- `apps/web/src/views/Dashboard.vue:8` — Hero eyebrow `AI NOVEL RUNTIME · DASHBOARD`
- `apps/web/src/views/Dashboard.vue:10-12` — Hero title `Build novels<br/><em>with one runtime.</em>`
- `apps/web/index.html:13` — `<title>AI Novel Runtime</title>` (浏览器 tab)
- `apps/server/src/app.ts:36-37` — Swagger UI title/description

**文档标题 (5 处):**
- `README.md:1` — `# AI Novel Runtime`
- `AGENTS.md:1-2, 12` — 标题 + 自指 `AI Novel Runtime`
- `CLAUDE.md:7` — `**AI Novel Runtime** is a pnpm monorepo ...`
- `Process.md:1` — `# AI Novel Runtime 运行流程说明`
- `docs/LOGIC.md:1` — `# LOGIC.md — AI Novel Runtime 架构速览`

**Dashboard 顶部中英混排不统一:** Hero eyebrow + title 是英文; lede 已经是中文 `{{ greeting }} — 你的故事工作台。统一管理写作人格、运行模型、章节生成与归档流水线。`; 按钮中文。新用户进 Dashboard 看到一个英文 hero + 中文主体的拼贴感,不一致。

---

## 2. 目标

1. **品牌一致**: NavBar、Swagger、浏览器 tab 用同一个中文名 `AI 小说工坊`
2. **Dashboard 顶部中文化**: eyebrow + hero title 改中文,跟 lede + 按钮语言一致
3. **文档标题同步**: README / AGENTS / CLAUDE / Process / LOGIC 五份文档的标题引用产品名时改中文
4. **代码库标识不动**: package name、目录名、GitHub repo 保持 `ai-novel-runtime` (改了就破坏 import 路径、git remote、CI 引用、对外 API header 等)

**非目标 (本期不做):**
- i18n 框架引入 — 项目不需要 (CLAUDE.md 明说)
- 完整文案本地化 (页面正文翻译) — 不在范围内
- 历史归档 spec 重命名 — 历史事实,不动

---

## 3. 设计决策

### 3.1 中文命名 (用户已确认)

**产品中文名:** `AI 小说工坊`

**选择理由 (用户已在 brainstorming 阶段确认):**
- 意译优先, AI 当作产品/技术前缀
- "工坊"暗示手工 + Studio/Atelier 调性, 跟 boords 风格设计气质贴
- 4 字符 + 2 字符 AI, 品牌名 + 后缀结构清晰
- 开发者 + 普通用户都易读

**保留英文的边界:**
- `package.json` 的 `name` (`@novel-runtime/web`, `@novel-runtime/server`, `novel-runtime`)
- 仓库目录 `ai-novel-runtime/`
- GitHub repo `SatomiKazeHiro/ai-novel-runtime`
- localStorage key `novel-runtime:theme` (theme 单测依赖)
- 对外 API header (`HTTP-Referer`, `X-Title` 给 DeepSeek/OpenRouter, 是技术字段不是品牌)

### 3.2 Dashboard Hero 文案 (用户已确认)

| 位置 | 现状 | 改为 |
|---|---|---|
| Hero eyebrow | `AI NOVEL RUNTIME · DASHBOARD` | `AI 小说工坊 · 控制台` |
| Hero title (主) | `Build novels` | `打造小说` |
| Hero title (em 强调) | `with one runtime.` | `在一个 AI 小说工坊里。` |

**Lede 不动:** `{{ greeting }} — 你的故事工作台。统一管理写作人格、运行模型、章节生成与归档流水线。` 已经是中文, 表达功能, 保留。

**按钮不动:** `新建小说` / `写作人格` 已中文。

### 3.3 文档标题 (用户已确认)

5 处文档标题改用 `AI 小说工坊` 替换 `AI Novel Runtime`:
- `README.md` — `# AI 小说工坊`
- `AGENTS.md` — `# AI 小说工坊 — Agent Guide` + 文档内自指引用
- `CLAUDE.md` — `**AI 小说工坊** is a pnpm monorepo ...`
- `Process.md` — `# AI 小说工坊 运行流程说明`
- `docs/LOGIC.md` — `# LOGIC.md — AI 小说工坊 架构速览`

**正文是否翻译:** 不动。 文档正文是给开发者看的, 内容是技术描述, 改成中文反而让代码示例、英文术语难以对齐。**只改标题 + 第一段自指。**

---

## 4. 文件改动清单

| 文件 | 行号 | 现状 | 改为 |
|---|---|---|---|
| `apps/web/src/components/NavBar.vue` | 15 | `AI Novel Runtime` | `AI 小说工坊` |
| `apps/web/src/components/NavBar.vue` | 47 | `AI Novel Runtime v0.1.0` | `AI 小说工坊 v0.1.0` |
| `apps/web/src/views/Dashboard.vue` | 8 | `AI NOVEL RUNTIME · DASHBOARD` | `AI 小说工坊 · 控制台` |

**"控制台" 选词依据:** Dashboard 的中文翻译常见三种 — "仪表盘" (偏 BI 数据展示) / "控制台" (偏系统/开发者视角) / "工作台" (偏操作界面)。本应用 Dashboard 是小说工程的入口面板, 跟 Swagger 控制台、Apache/Nginx 控制台是同类概念; "仪表盘" 在 SaaS 控制台场景不贴; "工作台" 在 App 中已有其他页面 (Chapters 工作台) 占用。**采用 "控制台"** — 简短、开发者熟悉、不与其他页面冲突。
| `apps/web/src/views/Dashboard.vue` | 10 | `Build novels<br />` | `打造小说<br />` |
| `apps/web/src/views/Dashboard.vue` | 11 | `<em>with one runtime.</em>` | `<em>在一个 AI 小说工坊里。</em>` |
| `apps/web/index.html` | 13 | `<title>AI Novel Runtime</title>` | `<title>AI 小说工坊</title>` |
| `apps/server/src/app.ts` | 36 | `title: 'AI Novel Runtime API'` | `title: 'AI 小说工坊 API'` |
| `apps/server/src/app.ts` | 37 | `description: 'API documentation for AI Novel Runtime'` | `description: 'AI 小说工坊 的 API 文档'` |
| `README.md` | 1 | `# AI Novel Runtime` | `# AI 小说工坊` |
| `AGENTS.md` | 1 | `# AI Novel Runtime — Agent Guide` | `# AI 小说工坊 — Agent Guide` |
| `AGENTS.md` | 2 | (first-line comment 自指) | (同步) |
| `AGENTS.md` | 12 | `**AI Novel Runtime** 是一个...` | `**AI 小说工坊** 是一个...` |
| `CLAUDE.md` | 7 | `**AI Novel Runtime** is a pnpm monorepo ...` | `**AI 小说工坊** is a pnpm monorepo ...` |
| `Process.md` | 1 | `# AI Novel Runtime 运行流程说明` | `# AI 小说工坊 运行流程说明` |
| `docs/LOGIC.md` | 1 | `# LOGIC.md — AI Novel Runtime 架构速览` | `# LOGIC.md — AI 小说工坊 架构速览` |

**不动 (7 处):**
- 所有 `package.json` 的 `name` 字段 (3 处) — 工程标识
- `packages/ai-provider/src/index.ts:70-71` `HTTP-Referer` / `X-Title` — 对外 API header
- `apps/web/src/stores/theme.ts` 中 `STORAGE_KEY = 'novel-runtime:theme'` — localStorage 兼容性 + 单测依赖
- `docs/superpowers/specs/2026-06-21-theme-switch.md` — 历史 spec
- `docs/superpowers/specs/2026-06-21-product-i18n-zh.md` — 本文
- `docs/DESIGN.md` — 未出现产品名
- `docs/superpowers/plans/*.md` — 历史 plan, 不动

**净行数:** 15 处文本替换, 行数不变。

---

## 5. 关键文件预览

### 5.1 `apps/web/src/components/NavBar.vue` (改后节选)

```vue
<!-- L15 -->
<span class="cap-nav__brand-text">AI 小说工坊</span>

<!-- L47 (about dropdown) -->
<n-text>AI 小说工坊 v0.1.0</n-text>
```

### 5.2 `apps/web/src/views/Dashboard.vue` (改后节选)

```vue
<span class="cap-eyebrow cap-rise" data-rise="1">
  <span class="cap-pencil" />
  AI 小说工坊 · 控制台
</span>
<h1 class="cap-display cap-rise" data-rise="2" style="margin: 16px 0 0">
  打造小说<br /><em>在一个 AI 小说工坊里。</em>
</h1>
```

### 5.3 `apps/web/index.html` (改后)

```html
<title>AI 小说工坊</title>
```

### 5.4 `apps/server/src/app.ts` (改后)

```ts
title: 'AI 小说工坊 API',
description: 'AI 小说工坊 的 API 文档',
```

### 5.5 `README.md` (改后)

```markdown
# AI 小说工坊
```

---

## 6. 测试

### 6.1 不写新单测

本次改动纯文本字符串替换, 无逻辑影响, 不需要新单测:
- theme.spec.ts 测的是 store 行为, 不依赖文案
- tokens.spec.ts 测的是 CSS 变量, 不依赖文案
- 现有 12 个单测在改动后仍应通过 (改动不触及被测代码)

### 6.2 验证清单

- `pnpm typecheck` 全过 (无 TS 类型变化)
- `pnpm --filter web test` 12/12 通过
- `pnpm --filter web lint` 通过 (如有配置)
- **grep 兜底:** `grep -rn "AI Novel Runtime\|AI NOVEL RUNTIME" apps/web/src apps/server/src README.md AGENTS.md CLAUDE.md Process.md docs/LOGIC.md docs/DESIGN.md` 应输出 0 行 (docs/DESIGN.md 历史就不出现, 其他全部改完)
- **视觉验证 (人工):**
  - NavBar brand 文字宽度变窄 (`AI Novel Runtime` 16 字符 → `AI 小说工坊` 6 字符), 检查对齐
  - Dashboard eyebrow `AI 小说工坊 · 控制台` 长度变短, 检查留白
  - 浏览器 tab title 显示 `AI 小说工坊`
  - Swagger UI 页面 title 显示 `AI 小说工坊 API`

---

## 7. 风险

- **NavBar 文字宽度变窄**: 中文 brand 6 字符比英文 brand 16 字符窄约 60%。NavBar 容量变小, 留白可能增加。**对策:** 实施后看效果, 如明显偏左调 `padding` 或 brand 容器宽度。
- **Dashboard hero 长度变化**: `打造小说 / 在一个 AI 小说工坊里。` 字数比 `Build novels / with one runtime.` 多约 30%, 可能换行。**对策:** 实施后看效果, cap-display 字号 56px 中文渲染不会折成 2 行。
- **文档遗漏**: 文档里 "AI Novel Runtime" 引用多, 一处漏改就破坏口径。**对策:** 实施前 grep 全文件确认命中数 = 11 (6 处面向用户 + 5 处文档), 实施后 grep 兜底 = 0。
- **grep 误伤**: 本 spec 文件名 `2026-06-21-product-i18n-zh.md` 中 "product i18n" 不含 "Novel Runtime", 安全。 但 `docs/superpowers/specs/2026-06-21-theme-switch.md` 历史 spec 仍含 "AI Novel Runtime" (提到主题切换功能时自指产品), **不动**。

---

## 8. 不在本期

- 完整页面正文翻译 (Dashboard lede 之外的所有页面文本) — 不在范围, 用户没要求
- i18n 框架引入 — 不需要 (CLAUDE.md)
- 国际化货币 / 日期格式 — 不适用
- 文档正文翻译 — 不动 (技术内容中文反而难读)

---

## 9. 实施顺序

**拆 2 commit:**

### commit 1: 平台标识中文化 (frontend + backend)
- `apps/web/src/components/NavBar.vue` (2 处)
- `apps/web/src/views/Dashboard.vue` (3 处)
- `apps/web/index.html` (1 处)
- `apps/server/src/app.ts` (2 处)
- 8 处文本, 净行数 ≈ 0 (替换)

### commit 2: 文档标题同步
- `README.md` (1 处)
- `AGENTS.md` (3 处)
- `CLAUDE.md` (1 处)
- `Process.md` (1 处)
- `docs/LOGIC.md` (1 处)
- 7 处文本, 净行数 ≈ 0

每步独立可验证:
1. commit 1 后 typecheck + web test + grep 兜底
2. commit 2 后 typecheck + grep 兜底

每步独立可回滚 (commit 1 出问题, 平台文案回退到英文, 文档不动; commit 2 出问题只回滚文档)。

---

## 10. 易扩展性

加新语言 (en / ja) 时:
- 引入 i18n key map (例如 `BRAND_NAME.zh = 'AI 小说工坊'`, `BRAND_NAME.en = 'AI Novel Runtime'`)
- 在 `apps/web/src/locales/` 加语言文件
- NavBar / Dashboard.vue / index.html 改用 `t('brand.name')` 引用
- 但本期不做 (CLAUDE.md 明确说不需 i18n)

如果将来想做 i18n, 这 15 处文本替换就变成 key 替换, 工作量 ≈ 半天 (主要是 Naive UI locale 已经接 zh-CN, 加 en 是配置项)。