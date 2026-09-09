# boords.com — Style Reference
> Warm storyboard studio on cream paper — a cream canvas, amber pencil accents, and flat geometric type that feels hand-drawn even when it's pure UI.

**Theme:** light

Boords operates in a warm, paper-like visual register: a cream canvas (#fafaf5) sits beneath pure white surfaces, with a single amber accent that feels more like a pencil highlight than a digital CTA. The custom 'matter' typeface carries a geometric, friendly character at every scale, with positive tracking on small-caps eyebrows and tight, confident headlines at 32–60px. The interface is deliberately flat — 6px corners are the default radius, shadows are nearly absent, and one dark section (the developer/API area) breaks the cream monotony without disrupting the calm. The aesthetic borrows from the storyboard world it serves: warm neutrals, soft radii, amber-warm action colors, and a hand-drawn quality in the product imagery that makes the UI feel like a creative tool rather than a productivity app.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Warm Cream | `#fafaf5` | `--color-warm-cream` | Page canvas, base surface — replaces pure white to give the interface a paper-like warmth |
| Pure White | `#ffffff` | `--color-pure-white` | Card surfaces, product UI panels, elevated content blocks |
| Ink Black | `#121212` | `--color-ink-black` | Primary text, dark section background, filled nav button, high-contrast borders |
| Stone Gray | `#e9e9e7` | `--color-stone-gray` | Section dividers, subtle alternating surfaces, input field backgrounds |
| Pebble Border | `#cecdca` | `--color-pebble-border` | Hairline borders on cards, dividers between sections, table separators |
| Graphite | `#4d4d4d` | `--color-graphite` | Secondary text, muted body copy, supporting labels |
| Mid Gray | `#7d7d7d` | `--color-mid-gray` | Tertiary text, icon strokes, disabled states, caption metadata |
| Muted Ash | `#898989` | `--color-muted-ash` | Placeholder text, subtle borders, low-emphasis text |
| Warm Gold | `#e8aa42` | `--color-warm-gold` | Primary CTA buttons, active state highlights — the amber pencil-mark accent that makes the single action feel warm and inviting rather than corporate |
| Deep Amber | `#eb6c00` | `--color-deep-amber` | Orange decorative accent for icons, marks, and small graphic details. Do not promote it to the primary CTA color |
| Burnt Honey | `#b77a1e` | `--color-burnt-honey` | Yellow decorative accent for icons, marks, and small graphic details. Do not promote it to the primary CTA color |
| Storyboard Blue | `#214c7e` | `--color-storyboard-blue` | Blue accent for outlined action borders, linked labels, and lightweight interactive emphasis |
| Sketch Blue | `#daeef8` | `--color-sketch-blue` | Hairline borders, dividers, input outlines, and card edges on light surfaces |

## Tokens — Typography

### matter — Primary typeface — custom geometric sans-serif with friendly proportions, used across all UI, body, and display contexts. Weight 400–500 for body and UI, 600–700 for headings and emphasis. · `--font-matter`
- **Substitute:** Inter or DM Sans
- **Weights:** 400, 500, 600, 700
- **Sizes:** 10px, 11px, 12px, 14px, 16px, 17px, 19px, 20px, 24px, 32px, 40px, 60px
- **Line height:** 1.10–1.70 depending on size
- **Letter spacing:** 0.025em at caption (10px), 0.05em at body-sm (12px), 0.1em for small-caps eyebrows (12–14px)
- **Role:** Primary typeface — custom geometric sans-serif with friendly proportions, used across all UI, body, and display contexts. Weight 400–500 for body and UI, 600–700 for headings and emphasis.

### ui-monospace — System monospace for code blocks, API endpoint paths, and technical metadata in the dark developer section · `--font-ui-monospace`
- **Substitute:** SF Mono, Menlo, Consolas
- **Weights:** 400, 500, 600
- **Sizes:** 9px, 11px, 16px
- **Line height:** 1.50
- **Role:** System monospace for code blocks, API endpoint paths, and technical metadata in the dark developer section

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 10px | 1.5 | 0.25px | `--text-caption` |
| body-lg | 17px | 1.5 | — | `--text-body-lg` |
| subheading | 20px | 1.45 | 1.2px | `--text-subheading` |
| heading-sm | 24px | 1.45 | — | `--text-heading-sm` |
| heading | 32px | 1.25 | — | `--text-heading` |
| heading-lg | 40px | 1.2 | — | `--text-heading-lg` |
| display | 60px | 1.1 | — | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** compact

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 28 | 28px | `--spacing-28` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 48 | 48px | `--spacing-48` |
| 56 | 56px | `--spacing-56` |
| 64 | 64px | `--spacing-64` |
| 80 | 80px | `--spacing-80` |
| 104 | 104px | `--spacing-104` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 6px |
| pills | 9999px |
| badges | 6px |
| images | 6px |
| inputs | 6px |
| buttons | 6px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| lg | `rgba(255, 255, 255, 0.03) 0px 0px 24px 0px` | `--shadow-lg` |
| subtle | `rgba(108, 188, 244, 0.5) 0px 0px 0px 1px` | `--shadow-subtle` |
| subtle-2 | `rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset` | `--shadow-subtle-2` |
| sm | `rgba(0, 0, 0, 0.1) 0px 2px 8px 0px` | `--shadow-sm` |

### Layout

- **Page max-width:** 1200px
- **Section gap:** 64px
- **Card padding:** 16px
- **Element gap:** 8px

## Components

### Amber CTA Button
**Role:** Primary action button used for the main conversion point (Try Boords Free, Sign Up)

Filled with #e8aa42, text in #121212, 6px border-radius, 10px vertical and 20px horizontal padding, matter 500 at 16px. Single warm-gold button per view — never paired with a second amber button on the same screen.

### Dark Filled Button
**Role:** Secondary navigation action (Log in, dashboard access)

Filled with #121212, text in #ffffff, 6px border-radius, 10px vertical and 20px horizontal padding, matter 500 at 16px. Used in the nav bar for authenticated actions.

### Ghost Text Link
**Role:** Inline link or supplementary action (Watch the demo, Explore API docs)

No background or border, text in #121212 (light theme) or #ffffff (dark section), matter 500 at 16px, underline on text-only links, right-arrow character (→) after text for navigational links. Padding: 0px.

### Storyboard Frame Card
**Role:** Product UI element showing an individual storyboard frame with metadata

White (#ffffff) background, 1px #cecdca border, 6px border-radius, 12px padding. Contains a pencil-sketch image (grayscale), frame number badge, title text (matter 500, 14px), and a small 'IMAGE GENERATOR' label with icon at the bottom. No shadow.

### Comment Thread Item
**Role:** Client feedback comment in the storyboard review interface

White (#ffffff) background, 1px #cecdca border, 6px border-radius, 16px padding. Contains user avatar (24px circle), name (matter 600, 14px, #121212), timestamp (matter 400, 12px, #7d7d7d), and comment text (matter 400, 14px, #4d4d4d). Highlighted replies use #e8aa42 text color for the quoted portion.

### Status Badge
**Role:** Project or frame status indicator (In Progress, Approved, Changes Requested)

6px border-radius, 4px vertical and 10px horizontal padding. Default state: #daeef8 background with #214c7 text and a 6px colored dot prefix. Text in matter 600 at 11px with 0.05em letter-spacing.

### API Endpoint Row
**Role:** HTTP endpoint display in the dark developer section

Dark surface (#121212 background) with HTTP method tag (GET, POST, PATCH, DELETE) as a small pill in the left margin, endpoint path in ui-monospace 400 at 11px in #cecdca, and description text in matter 400 at 12px in #7d7d7d. Method tags use muted semantic colors (green for GET, blue for POST, yellow for PATCH, red for DELETE) at low saturation. 6px border-radius on the overall row card.

### Section Eyebrow Label
**Role:** Small-caps category label above section headlines (e.g., '11 YEARS OF VIDEO PREPRODUCTION SIGN-OFF')

Matter 600 at 11px, uppercase, #7d7d7d text color, 0.1em letter-spacing. No background or border. Sits 12px above the section heading.

### Testimonial Card
**Role:** Social proof quote from a customer

Cream (#fafaf5) background — sits on the white section to create subtle separation, no border, 6px border-radius, 24px padding. Quote text in matter 400 at 16px, #4d4d4d. Company name below in matter 600 at 14px, #121212.

### Logo Bar Item
**Role:** Customer/studio logo in the social proof strip

Monochrome black (#121212) treatment, no background or border, contained within the cream section. Logos are rendered at uniform height (~24px) with consistent spacing (32px between items) in a single horizontal row.

## Do's and Don'ts

### Do
- Use #fafaf5 as the page canvas — the warm cream is the brand's defining surface and should never be replaced with pure white at the base layer.
- Reserve #e8aa42 exclusively for the single primary CTA per view. No secondary amber buttons, no amber icons in the same frame as the CTA.
- Use 6px border-radius as the default for all cards, buttons, inputs, and images. Only use 9999px for pill-shaped tags and the optional pill button variant.
- Apply positive letter-spacing (0.05–0.1em) only to small-caps eyebrows and labels. Body and display text use normal tracking.
- Keep the interface flat: separate layers with 1px #cecdca borders, not drop shadows. The only acceptable shadow is rgba(0,0,0,0.1) 0px 2px 8px for floating product screenshots.
- Use matter at 400 for body, 500 for UI and links, 600–700 for headings. Never set matter below 400 — the typeface loses character at light weights.
- Use ui-monospace only in the dark developer section for API endpoints and code. Body text is always matter.

### Don't
- Don't use #ffffff as the page background — the cream canvas (#fafaf5) is the brand signature, not pure white.
- Don't use #214c7 (storyboard blue) for CTA buttons — it's for links, status badges, and informational accents only. The CTA is always amber.
- Don't apply drop shadows to cards or panels — use 1px borders or the cream-to-white surface difference for separation.
- Don't use border-radius above 12px for cards or panels — 6px is the maximum standard radius. Larger radii break the flat, workspace-like feel.
- Don't place chromatic colors as decoration — every saturated color must serve a function (CTA, link, status, icon accent).
- Don't extend the dark section beyond the developer/API area — the rest of the interface stays on cream and white.
- Don't use the excluded content/code colors (#e5f2d5, #f8dfe6, #ffd1c9, #b6defa) outside of code block and syntax-highlighting contexts.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Cream Canvas | `#fafaf5` | Page-level base — the warm paper-like ground that defines the entire interface |
| 2 | White Card | `#ffffff` | Product UI panels, storyboard frame cards, and elevated content blocks that need to feel crisp against the cream |
| 3 | Stone Section | `#e9e9e7` | Alternate section background for subtle visual separation without a hard border |
| 4 | Dark Workspace | `#121212` | Developer/API section background — the only dark surface, used for the integration showcase |

## Elevation

Boords avoids elevation almost entirely. Cards use 1px pebble borders (#cecdca) rather than shadows to separate from the cream canvas. The only meaningful shadow is rgba(0, 0, 0, 0.1) 0px 2px 8px 0px used sparingly on floating product screenshots. In the dark developer section, surfaces are defined by inner highlights (rgba(255, 255, 255, 0.1) 1px inset) rather than drop shadows. Focus states use a 1px blue ring (rgba(108, 188, 244, 0.5)) rather than glow. The flatness is intentional: it keeps the interface feeling like a workspace rather than a layered app.

## Imagery

The visual language is illustration-first, rooted in the storyboard medium. Product screenshots show hand-drawn pencil-sketch frames — grayscale line art with light washes, evoking animator's thumbnails. The product UI itself is the hero imagery: the storyboard editor, comment threads, and API panel are shown as large embedded screenshots rather than abstract graphics. No photography, no stock imagery, no 3D renders. The only decorative graphics are the hand-drawn storyboard frames within the product UI. Logo bar items (Vidico, Digital Brew, Framestore, etc.) are monochrome black treatment on the cream background, reinforcing the flat, restrained aesthetic. Image treatment: contained within rounded cards (6px radius), never full-bleed except in the hero product showcase.

## Layout

Max-width 1200px centered container, light theme throughout except one dark developer section. Navigation is a simple top bar with left-aligned logo, centered nav links (Features, Resources, About, Pricing), and right-aligned actions (Log in + amber CTA). Hero pattern: text-left, product-screenshot-below, no full-viewport imagery — the headline and subtext sit on the cream canvas with a generous product screenshot spanning the full content width beneath. Section rhythm: consistent vertical breathing room (64px section gaps) with seamless flow between cream and white surfaces. Content arrangement alternates between centered text stacks (hero) and 3-column grids (testimonials, feature cards, logo bar). The dark developer section breaks the pattern: full-width #121212 background with embedded API code panels. Grid usage: 3-column testimonial grid, 3-column logo bar, single-column storyboard frame grid within the product UI. Navigation: minimal top bar, no sticky behavior, no mega-menu.

## Agent Prompt Guide

**Quick Color Reference**
- Text: #121212 (primary), #4d4d4d (secondary), #7d7d7d (tertiary)
- Background: #fafaf5 (canvas), #ffffff (card surface)
- Border: #cecdca (hairline), #e9e9e7 (subtle divider)
- Accent: #214c7e (links, status)
- primary action: #e8aa42 (outlined action border)

**Example Component Prompts**

1. Create an Outlined Primary Action: Transparent background, #e8aa42 border and text, 9999px radius, compact pill padding. Use it for the main CTA instead of a filled button.

2. *Create a storyboard frame card:* White (#ffffff) background, 1px #cecdca border, 6px radius, 12px padding. Placeholder image area (grayscale sketch style) at top. Frame number badge (6px radius, #daeef8 bg, #214c7e text, 11px matter 600). Title at 14px matter 500, #121212. 'IMAGE GENERATOR' label at 11px matter 600, #7d7d7d with small icon.

3. *Create a status badge:* 6px radius, 4px 10px padding, #daeef8 background, 6px #214c7e dot prefix, text 'In Progress' in matter 600 at 11px with 0.05em letter-spacing, #214c7e color.

4. *Create a testimonial card:* #fafaf5 background (sits on a white section), 6px radius, 24px padding, no border. Quote text at 16px matter 400, #4d4d4d. Company name at 14px matter 600, #121212 below the quote.

5. *Create a navigation bar:* White (#ffffff) background, 64px height, matter 500 at 16px nav links in #121212. Left: logo (black 'BOORDS' wordmark). Right: 'Log in' dark filled button (#121212 bg, #ffffff text, 6px radius) and 'Try Boords Free' amber button (#e8aa42 bg, #121212 text, 6px radius).

## Similar Brands

- **Pitch** — Shares the warm cream canvas, amber/gold primary accent, and geometric sans-serif typography — the same paper-like workspace aesthetic
- **Frame.io** — Same light-theme product UI with flat cards, hairline borders, and minimal shadows — both serve video production professionals with clean, tool-like interfaces
- **Linear** — Compact density, 6px radii, nearly shadowless flat surfaces, and a restrained chromatic palette with one functional accent color
- **Notion** — Warm neutral palette, minimal elevation, and a workspace-like flatness that makes the interface feel like a document rather than an app
- **Figma** — Creative-tool aesthetic with contained product UI panels, monochrome logo bars, and a light-theme-first design with minimal decorative chrome

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-warm-cream: #fafaf5;
  --color-pure-white: #ffffff;
  --color-ink-black: #121212;
  --color-stone-gray: #e9e9e7;
  --color-pebble-border: #cecdca;
  --color-graphite: #4d4d4d;
  --color-mid-gray: #7d7d7d;
  --color-muted-ash: #898989;
  --color-warm-gold: #e8aa42;
  --color-deep-amber: #eb6c00;
  --color-burnt-honey: #b77a1e;
  --color-storyboard-blue: #214c7e;
  --color-sketch-blue: #daeef8;

  /* Typography — Font Families */
  --font-matter: 'matter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-ui-monospace: 'ui-monospace', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* Typography — Scale */
  --text-caption: 10px;
  --leading-caption: 1.5;
  --tracking-caption: 0.25px;
  --text-body-lg: 17px;
  --leading-body-lg: 1.5;
  --text-subheading: 20px;
  --leading-subheading: 1.45;
  --tracking-subheading: 1.2px;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.45;
  --text-heading: 32px;
  --leading-heading: 1.25;
  --text-heading-lg: 40px;
  --leading-heading-lg: 1.2;
  --text-display: 60px;
  --leading-display: 1.1;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-28: 28px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-104: 104px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 64px;
  --card-padding: 16px;
  --element-gap: 8px;

  /* Border Radius */
  --radius-md: 6px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-2xl-2: 21.6px;
  --radius-full: 9999px;

  /* Named Radii */
  --radius-cards: 6px;
  --radius-pills: 9999px;
  --radius-badges: 6px;
  --radius-images: 6px;
  --radius-inputs: 6px;
  --radius-buttons: 6px;

  /* Shadows */
  --shadow-lg: rgba(255, 255, 255, 0.03) 0px 0px 24px 0px;
  --shadow-subtle: rgba(108, 188, 244, 0.5) 0px 0px 0px 1px;
  --shadow-subtle-2: rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset;
  --shadow-sm: rgba(0, 0, 0, 0.1) 0px 2px 8px 0px;

  /* Surfaces */
  --surface-cream-canvas: #fafaf5;
  --surface-white-card: #ffffff;
  --surface-stone-section: #e9e9e7;
  --surface-dark-workspace: #121212;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-warm-cream: #fafaf5;
  --color-pure-white: #ffffff;
  --color-ink-black: #121212;
  --color-stone-gray: #e9e9e7;
  --color-pebble-border: #cecdca;
  --color-graphite: #4d4d4d;
  --color-mid-gray: #7d7d7d;
  --color-muted-ash: #898989;
  --color-warm-gold: #e8aa42;
  --color-deep-amber: #eb6c00;
  --color-burnt-honey: #b77a1e;
  --color-storyboard-blue: #214c7e;
  --color-sketch-blue: #daeef8;

  /* Typography */
  --font-matter: 'matter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-ui-monospace: 'ui-monospace', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* Typography — Scale */
  --text-caption: 10px;
  --leading-caption: 1.5;
  --tracking-caption: 0.25px;
  --text-body-lg: 17px;
  --leading-body-lg: 1.5;
  --text-subheading: 20px;
  --leading-subheading: 1.45;
  --tracking-subheading: 1.2px;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.45;
  --text-heading: 32px;
  --leading-heading: 1.25;
  --text-heading-lg: 40px;
  --leading-heading-lg: 1.2;
  --text-display: 60px;
  --leading-display: 1.1;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-28: 28px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-104: 104px;

  /* Border Radius */
  --radius-md: 6px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-2xl-2: 21.6px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-lg: rgba(255, 255, 255, 0.03) 0px 0px 24px 0px;
  --shadow-subtle: rgba(108, 188, 244, 0.5) 0px 0px 0px 1px;
  --shadow-subtle-2: rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset;
  --shadow-sm: rgba(0, 0, 0, 0.1) 0px 2px 8px 0px;
}
```

---

## 决策日志

## v3 记忆系统重设计（2026-07-30, branch `v2/state-machine`）

**Why**: v3 stage 拆分后，记忆抽取、跨章融合、人工审查、归档写库和 prompt 检索之间没有形成闭环：`memory-optimizer.ts` 无调用方，archive confirm 只写 Chapter 图谱列，`searchRelevant` 又会把同一 `originUid` 的多个历史版本一起参与召回。

**What**:
- `memory-stage` 使用 `buildExtractPrompt(..., { mode: 'memory-only' })`（v3 新增 mode：保留 v2 详细记忆约束 + 跨章上下文 `previousEntitiesBlock`，但删除「任务2：实体与关系提取」段及对应 schema 字段），同时删除 `characterStatusChanges` / `timelinePosition` / `timelineEvents` 死字段，只输出分类 raw 结果与 `summary`。
- 4 个 stage 并行完成后，在 `prepare-archive` 阶段运行 optimizer；融合结果覆盖 `stages.memory.result.memories`，让用户审查的是最终全局记忆。
- optimizer 每条输出统一为 `{ content, originUid, importance, type: 'event' | 'state' }`；后端添加 `['auto-extracted', type]`，不再存在 `user-edited` 特殊分支。
- archive confirm 只负责事务写库，不调用 AI：分类 raw 记忆写 `layer='chapter'`，关键地点写 `layer='scene'`，融合记忆写 `layer='global'`，摘要写 `Chapter.summary`。
- global 记忆按章累加历史版本，不按 UID update；`searchRelevant` 仅对 `layer='global'` 按 `originUid` 取最新版本，chapter 层不参与 UID 收缩。
- 删除章节继续按 `fromChapterNumber` 清理该章产生的行；此前版本仍在，检索因此自然回退到前一版本。

**Trade-off**:
- prepare-archive 多一次同步 AI 调用，进入 reviewing 的等待时间增加；换取用户能在归档前审阅融合结果，archive confirm 保持确定性的 commit-only 行为。
- global 层保留历史版本会增加存储量；换取删章节无需重算或恢复快照，回退语义由现存版本自然实现。
- scene 层只供 Memory UI 展示，不注入生成 prompt；chapter 与 global 层职责保持独立，不互相替代。

**How to apply**: 后续修改记忆链路时，以“分类 raw 提取 → prepare 阶段融合 → 人工审查 → commit-only 三层写库 → global UID 最新版本检索”为固定顺序。完整字段、layer、tags 与测试规则见 `docs/superpowers/specs/2026-07-30-v3-memory-system-design.md`。

## v2 状态机重构（2026-07-24, branch `v2/state-machine`）

**Why**: 原 8 态枚举把"候选生成锁"和"章节业务状态"两个独立维度挤进同一个字段，导致 select/prepare-archive 失败时的回滚语义被迫引入 `preLockStatus` 等补丁字段。Worker 与路由相互等待对方写 status 的耦合让 archive 并发场景极易踩坑。

**What**:
- `ChapterStatus` 收口到 3 值：`draft` / `reviewing` / `archived`
- 候选生成与章节状态正交：worker 不再 `updateMany` chapter.status
- `select` 路由不再翻 chapter.status；同章其余 draft 置 `rejected`，选中 draft 的 content 写入 `chapter.content`（v2 删除 `Draft.status='selected'` 标记与 `overrideContent` 标志）
- 失败的 prepare-archive 统一回退到 `draft`
- archived 章节不可再生成新候选（UI 层隐藏按钮，路由层兜底 400）

**Trade-off**:
- 失去"章节正在生成中"的全局可见信号；UI 改用 Draft 层聚合判断
- 单向 archived 让"取消归档"语义不存在 —— 取消 = 删章节 + 级联清快照
- migration 单步：老 DB 必须先迁移；期间若有新写入按旧 enum 校验会失败

**How to apply**: 未来新增章节相关功能时，候选相关问题去 Draft 层查，章节业务流转查 `ChapterStatus`，两者不要混用。

**下个 phase 候选 (v3 之前)**：
- **拆分"归档中"工作流**：当前 `prepare-archive` 一路由串了 4 phase（extract → organize graph → human review → confirm），状态机层面已用 `reviewing` 收口但路由仍单点。v3 应把 4 phase 拆为独立 sub-route 或后台 job，让每步可独立 retry / observability。前端 ReviewingPanel 当前承担了"review" 阶段的 UI，下一步要把"extract / organize" 也搬到前端可见的进度条。
- **删除 TimelineEvent**（v3 标记，2026-07-24 已写入 schema 注释）：详见下方决策日志"Y3 标记：TimelineEvent 废弃"。
- **如何开始**：当再次出现"某个 phase 失败要把整个 archive 流程回退"的报告时，就是 v3 的触发信号。

实现细节：5 个 commit × 1 branch，spec 在 `docs/superpowers/specs/2026-07-24-v2-state-machine-design.md`，plan 在 `docs/superpowers/plans/2026-07-24-v2-state-machine.md`。

## v3 归档流水线拆 4 stage（2026-07-25, branch `v3/prepare-archive-stages`）

**Why**: v2 的 `prepare-archive` 单路由串了 4 phase（extract → organize graph → human review → confirm），任一阶段失败都要整个 archive 流程回退。每个阶段是独立 AI 调用、独立的失败语义（AI 格式错误 vs 图谱 token 溢出 vs 用户编辑冲突），耦合在一个 handler 里导致错误提示粒度粗、retry 只能整段重来。

**What**:
- `Chapter.pendingArchiveData` v3 shape:
  ```typescript
  {
    version: 3,
    stages: {
      character: StageState,
      memory: StageState,
      plotArc: StageState,
      graph: StageState
    },
    meta: { extractedAt, chapterNumber }
  }
  ```
- 4 stage 服务位于 `apps/server/src/services/stages/`,签名一致:
  ```typescript
  async function runXxxStage(app, input): Promise<StageState<XxxStageResult>>
  ```
  并行触发 (`Promise.all`),任一失败不影响其他。空结果 = success。
- `Chapter.chapterGraph` (gacha, 单次 AI 抽取本章) 与 `Chapter.cumulativeGraph` (累计到本章, 经 N-1 去重) 两段式。
- `buildCumulativeGraph` (`apps/server/src/services/cumulative-graph.ts`):
  1. 空 chapterGraph → 继承 prev (no AI)
  2. 首章 → chapterGraph 自身 (no AI)
  3. 正常 → AI 做 relation 字面归一映射(同义/升级/反转归到一个字面)→ 程序按映射重写 prev + chapterGraph 全部 relation → codeMerge 按五元组 key 合并
- relation 漂移解决方案: AI dedup 阶段只输出 `mappings: [{from, to, variants, canonical}]`,程序 `applyRelationMapping` 重写边 relation 字面,再交给 `codeMerge` 按 `${fromType}:${fromKey}|${relation}|${toType}:${toKey}` 五元组去重 + weight 累加。原"1 跳邻域 AI 压缩图谱"在跨章 relation 字面漂移(例: c1 收留/决定帮助, c2 收留并帮助, c3 收留)下会让累计图谱累积多条字面不同的边,改用全量 prev 输入 + 映射表方案后能真正合并。
- v3 删除所有 `updateMany({where: {status: ...}})` 锁。仅依赖状态机自身 + UI 按钮 disabled 防双击。

**Trade-off**:
- 老的 1 次合并提取拆为 4 次 AI 调用，平均 AI 成本上升，但单 stage 失败可独立重试（前端"重新解析"按钮按 stage 触发）
- `GraphNode` / `GraphEdge` 工作表过渡期仍写入；GraphView.vue 重写延后到下一个独立 commit（**已完成 2026-07-29**: GraphView 改读 `cumulativeGraphApi`，两表随 migration `20260729000000_drop_graph_node_edge` 删除）
- 老 v1/v2 blob 无 `version` 字段 → 前端检测后提示"数据格式过旧，请重新准备归档"

详细 stage 边界与 `pendingArchiveData` v3 字段语义见 `docs/LOGIC.md` 中"Stage 边界 (v3)"章节。

## Y3 标记：TimelineEvent 废弃（2026-07-24，仅标记，不实施）

**Why**: TimelineEvent 在当前实现里有两个不可调和的设计缺陷 —
- **强时间戳假设**：`position` 是 Y.DDDHH 浮点数（年.年内第N天第N小时），预设"故事存在一根绝对时间轴"。无时间设定、时间模糊（"几十年前"）、嵌套叙事、回忆、平行世界等类型下，AI 要么强行编一个无意义的 Y.DDDHH（污染），要么抽不出（丢信息）。
- **全文注入反模式**：`chapters-generate.ts:74,103` 用 `findMany` 全量拉所有 TimelineEvent 塞进 prompt，与 Memory.semantic recall top-K 形成对比 —— 章节越多 prompt 越长，但绝大多数事件与"当前章节要写什么"无关。
- **与 Memory 大量重叠**：Memory 已经是检索驱动、容忍模糊、自由文本，能覆盖 timeline 约 80% 的职责。多出来的 20%（"按时间排序的世界事件序列"）对很多故事类型无意义。

**What**: v3 实施时一次性砍掉。具体动作待 v3 brainstorm 时定，目前候选两个方向：
- A. **完全删除 TimelineEvent 表**，把"事件"作为 Memory 的一个 layer（`layer='event'`）。最简。
- B. **保留但弱化**：`position` 改可选（null = 时间未定），`chapterNumber` 必填 + 可选 `narrativeTime`（"几天前"、"第一章时"）；注入改 top-K 检索共享 memory 路径。保留序列感。

**Trade-off**:
- A 失去"按绝对时间排序"能力，对无时间/模糊时间类故事无损失；对有绝对纪年类故事需先确认是否真的需要这能力。
- B 向后兼容更好，但保留一个 schema 复杂度换 20% 功能。
- 无论 A/B，都不再承担"独立于 memory 的世界事件索引"这一职责 —— 这是这次决策的核心。

**How to apply**:
- v2 期间**不动 TimelineEvent 表**（保留向后兼容，已有数据继续可用）。新增 prompt 注入、archive 抽取逻辑继续走 TimelineEvent。
- **新功能不要依赖 TimelineEvent**（schema 已加 `/// @deprecated` 注释，IDE 会显示）。遇到"需要按时间排序的世界事件"的场景，先评估 semantic memory 是否能覆盖。
- **前端不要写新 UI 引用 TimelineEvent**。ChapterEditor / ReviewingPanel 中已有的 timeline 视图保留到 v3。
- v3 启动时连同其他候选（拆分 prepare-archive 工作流）一并规划 migration。
- **触发条件**：v3 真正开始时。如果项目长期停留在 v2，timeline 也不应急于删除 —— 留着比砍了更安全（数据还在）。
