# Novel Cover Upload + Card View — Design Spec

**Goal:** 在"小说管理"页面(`apps/web/src/views/Stories.vue`)新增：
1. 封面上传（后端接收并落盘，DB 存相对路径）
2. 卡片视图模式（除现有 NDataTable 之外的展示方式）
3. "仅显示含封面"过滤开关
4. 视图模式 + 过滤状态 持久化到浏览器（localStorage，不入 DB）

> 范围：仅 Stories 页改动，**不动**其他 view、不动 chapter / character / lore 等模型。

---

## 1. 现状

- `apps/web/src/views/Stories.vue` 当前是单一 `NDataTable`，列：标题/简介/状态/写作助手/模型/章节数/角色数/更新时间/操作。
- Prisma `Story` 模型没有封面字段。
- `apps/server/src/routes/stories.ts` 是纯 JSON 路由，**无 multipart / 无文件上传 / 无静态资源服务**。
- 前端 `apps/web/public/` 是 Vite 静态目录（untracked，与本设计无关）。
- 已有 localStorage 持久化先例：`apps/web/src/stores/theme.ts`、`apps/web/src/stores/story.ts`。
- 项目**无测试文件**（见 `KNOWN-ISSUES.md`），Vitest 已就绪但缺脚手架。

## 2. 目标

1. **封面上传**：编辑 modal 内可上传 JPG/PNG/WebP ≤2MB；可移除；服务端同步删旧文件
2. **卡片视图**：3:4 书脊式；无封面用印章首字占位（hash 渐变色 + 首字 + "印"角标）
3. **过滤**：工具栏 toggle，控制"仅显示含封面"
4. **持久化**：视图模式 + 过滤状态各自一个 localStorage key，刷新后恢复
5. **代码原则**（用户原话）：**解耦、易读、可扩展** —— 后端 multipart 抽成 plugin；前端视图/过滤抽成 composable；印章算法抽成纯函数

**非目标**（本期不做）：
- 封面裁剪/压缩/EXIF 处理（落盘即可）
- 封面 CDN / S3 上传（本地磁盘足够）
- 章节 / 角色 / 世界观等其他模型的封面
- 启动时扫孤儿文件（Follow-up）
- 前端单元测试（按 CLAUDE.md 精神，本期不强加）

## 3. 设计决策

### 3.1 存储策略（用户已确认）

| 候选 | 决策 |
|---|---|
| 本地磁盘 + `@fastify/static` 服务 | **采用** |
| DB BLOB / base64 | 否决：列表接口膨胀、SQLite 不适合大对象 |
| 前端 IndexedDB | 否决：多设备/换浏览器丢数据 |
| 外链 URL | 否决：违背"上传"需求 |

### 3.2 上传入口（用户已确认）

| 候选 | 决策 |
|---|---|
| 仅编辑 modal 上传 | **采用** |
| 列表/卡片直接 hover 上传 | 否决：需独立端点、边界条件多 |
| 两处都能 | 否决：代码量翻倍、状态协调麻烦 |

### 3.3 服务端硬限制（用户已确认）

| 候选 | 决策 |
|---|---|
| 后端 multipart 限制大小 + mime 白名单 | **采用** |
| 仅前端校验 | 否决：可绕过 |
| 不限 | 否决：磁盘塞满风险 |

### 3.4 卡片布局（用户已确认）

**采用** 书脊式（3:4 封面在上、标题/简介/状态 chip 在下，最像豆瓣读书）。

### 3.5 无封面占位（用户已确认）

**采用** 印章首字：标题第一个字（CJK 直接用 / ASCII 用首字母大写）+ 基于 title 的 FNV-1a hash 渐变色 + 右下角"印"角标。

### 3.6 过滤切换 UI（用户已确认）

**采用** 2 态 toggle：默认全部，开关打开时仅显示含封面。最简单、状态最直观、持久化最干净。

| 候选 | 决策 |
|---|---|
| 2 态 toggle（仅显示含封面） | **采用** |
| 3 态 segmented（全部/含/无） | 否决：用户决策中倾向 2 态 |
| 多选 chips | 否决：操作步数多 |

### 3.7 移除封面（用户已确认）

**采用** 编辑 modal 内"移除封面"按钮 → 调 `DELETE /api/stories/:id/cover` → DB 清字段 + unlink 磁盘文件（幂等）。

### 3.8 默认视图（用户已确认）

**采用** 表格（沿用现状，最小风险）。用户主动切到卡片后写入 localStorage。

### 3.9 卡片点击行为（用户已确认）

**采用** 整卡可点 = 跳设计区（`/novel-design/:id/characters`）；右上角 `⋯` 菜单（hover 出现）= 编辑 / 删除。

## 4. 架构与文件改动

### 4.1 新增

| 路径 | 作用 |
|---|---|
| `apps/server/uploads/covers/` | 封面文件落盘目录（运行时 mkdir，**gitignore**） |
| `apps/server/src/plugins/upload.ts` | Fastify multipart 插件封装（限制 2MB） |
| `apps/server/src/routes/covers.ts` | `DELETE /api/stories/:id/cover` 端点 |
| `apps/web/src/components/StoriesCards.vue` | 卡片视图组件（CSS Grid 自适应） |
| `apps/web/src/components/StoryCover.vue` | 单本书封面渲染（印章首字占位算法） |
| `apps/web/src/composables/useStoriesViewPrefs.ts` | localStorage 持久化的视图/过滤偏好 |
| `apps/server/src/routes/__tests__/` | vitest 脚手架（首期） |

### 4.2 修改

| 路径 | 改动 |
|---|---|
| `prisma/schema.prisma` | `Story` 加 `coverUrl String?` |
| `prisma/migrations/...` | `pnpm db:migrate` 自动生成 `add_story_cover_url` |
| `apps/server/src/app.ts` | 注册 covers 路由；注册 `@fastify/static` 服务 uploads 目录 |
| `apps/server/src/server.ts` | 启动时 `fs.mkdirSync(uploadsRoot, {recursive:true})` |
| `apps/server/src/routes/stories.ts` | PUT 接受 multipart（可选 `cover` 文件 + `removeCover` 标志）；GET 返回含 `coverUrl`；DELETE 时 cascade 删 covers 目录里 `{storyId}-*.*` 文件 |
| `apps/web/src/views/Stories.vue` | 工具栏加视图切换 + 过滤 toggle；编辑 modal 加封面上传/移除；按 viewMode 渲染 `<StoriesCards>` 或 `<StoriesTable>` |
| `apps/web/src/api/stories.ts` | types 加 `coverUrl?: string \| null`；新增 `storiesApi.removeCover(id)` |
| `.gitignore` | 加 `apps/server/uploads/` |

### 4.3 数据流（端到端）

```
[用户切换视图 / 过滤]
  → useStoriesViewPrefs 写 localStorage

[编辑 modal 上传]
  FormData { title, description, cover<File>, removeCover<'true'> }
  → PUT /api/stories/:id (multipart/form-data)
  → uploadPlugin 解析 → 大小/mime 校验
  → fs.writeFile → /uploads/covers/{storyId}-{ts}.{ext}
  → unlink 旧 coverUrl 文件（如果存在）
  → app.prisma.story.update({coverUrl: '/uploads/covers/...'})
  → return updated story
  → 前端刷新 stories

[编辑 modal 移除]
  → DELETE /api/stories/:id/cover
  → app.prisma.story.update({coverUrl: null})
  → fs.unlink 旧文件（失败 log 不抛）
  → return {success:true}
  → 前端刷新 stories

[卡片渲染]
  <StoryCover :story="s" />
  → s.coverUrl 真 → <img :src="resolveUrl(s.coverUrl)">
  → s.coverUrl 空 → 印章首字占位（FNV-1a hash 渐变 + 首字 + "印"）

[图片静态资源]
  浏览器 GET /uploads/covers/foo.jpg
  → @fastify/static 服务 apps/server/uploads/
```

## 5. 数据模型

```prisma
model Story {
  id                 String   @id @default(uuid())
  title              String
  description        String?
  status             String   @default("active")
  coverUrl           String?  // 相对路径,如 /uploads/covers/{storyId}-{ts}.jpg
  aiProviderConfigId String?
  // ...
}
```

**文件命名约束**：`/^\\/uploads\\/covers\\/[a-f0-9-]+-\\d+\\.(jpg|png|webp)$/`（前端用此 regex 校验 `coverUrl`，防 XSS / 路径穿越）。

## 6. API 详细

### 6.1 `PUT /api/stories/:id`（multipart/form-data）

**Body 字段**（全部可选，仅传了的字段会被更新）：
- `title: string` — 标题（≥1 字符）
- `description: string` — 简介
- `status: 'active'|'completed'|'archived'` — 状态
- `runtimeProfileId: string|null`
- `aiProviderConfigId: string|null`
- `cover: File` — 单文件，可选；mime ∈ {image/jpeg, image/png, image/webp} 且 ≤2MB
- `removeCover: 'true'` — 标志字符串，传了就先 unlink 旧文件再处理新文件

**响应**：`{success:true, data: story}` / `{success:false, error, statusCode:400|413|415}`

**校验失败状态码**：
- 413 — 文件 >2MB（Fastify multipart 抛 `FST_FILES_LIMIT`）
- 415 — mime 不在白名单
- 400 — 字段校验失败（zod）

### 6.2 `DELETE /api/stories/:id/cover`（新）

**响应**：`{success:true}`（幂等，coverUrl 已为 null 时直接返回）

**行为**：
1. 查当前 coverUrl
2. 若非空：`fs.unlink` 磁盘文件（失败仅 log）
3. `app.prisma.story.update({coverUrl: null})`

### 6.3 `DELETE /api/stories/:id`（改）

**新增 cascade 清理**：DB 删除后扫描 `uploads/covers/{storyId}-*.*` 并 unlink（失败仅 log）。

### 6.4 `GET /api/stories` / `GET /api/stories/:id`（不变）

list payload 自然带 `coverUrl`，前端按需判断真假。

## 7. 前端组件

### 7.1 `useStoriesViewPrefs.ts`

```ts
const VIEW_KEY = 'novel-runtime:stories-view-mode'
const FILTER_KEY = 'novel-runtime:stories-cover-filter'

export function useStoriesViewPrefs() {
  const viewMode = ref<'table' | 'cards'>(
    (localStorage.getItem(VIEW_KEY) as any) || 'table'
  )
  const coverFilter = ref<'all' | 'with-cover'>(
    (localStorage.getItem(FILTER_KEY) as any) || 'all'
  )

  watch(viewMode,    v => localStorage.setItem(VIEW_KEY, v), { flush: 'post' })
  watch(coverFilter, v => localStorage.setItem(FILTER_KEY, v), { flush: 'post' })

  return { viewMode, coverFilter }
}
```

### 7.2 `StoryCover.vue` 印章首字算法

```ts
// FNV-1a 32-bit — 稳定、低碰撞、零依赖
function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function hashColor(title: string): { from: string; to: string } {
  const hue = fnv1a32(title) % 360
  return {
    from: `hsl(${hue}, 45%, 35%)`,
    to:   `hsl(${(hue + 30) % 360}, 55%, 20%)`
  }
}

function firstGlyph(title: string): string {
  const t = title.trim()
  if (!t) return '?'
  const first = t[0]
  if (/[一-鿿぀-ヿ가-힯]/.test(first)) return first
  return first.toUpperCase()
}
```

> 算法抽到 `StoryCover.vue` 内的 `<script setup>` 顶部 pure functions，**不依赖外部状态**，便于单测复用。

### 7.3 `StoriesCards.vue` 网格

```vue
<div class="stories-cards">
  <div
    v-for="story in stories"
    :key="story.id"
    class="stories-cards__item"
    @click="onDesign(story.id)"
  >
    <StoryCover :story="story" />
    <div class="stories-cards__title">{{ story.title }}</div>
    <div class="stories-cards__desc">{{ story.description }}</div>
    <div class="stories-cards__meta">
      <span>{{ story.status }}</span>
      <span>· {{ story._count.chapters }} 章</span>
      <span>· {{ story._count.characters }} 角色</span>
    </div>
    <n-dropdown :options="menuOptions(story)" trigger="click">
      <button class="stories-cards__menu" @click.stop>⋯</button>
    </n-dropdown>
  </div>
</div>

<style scoped>
.stories-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
.stories-cards__item {
  cursor: pointer;
  /* cap-card 风格继承 */
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  /* ... */
}
</style>
```

### 7.4 `Stories.vue` 工具栏

```vue
<header class="page-head">
  <div class="page-head__text">
    <span class="cap-eyebrow is-accent">STORIES</span>
    <h1 class="page-head__title">小说管理</h1>
    <p class="page-head__lede cap-body-sm">每个故事是一个独立的运行时沙盒……</p>
  </div>
  <div class="page-head__actions">
    <button class="cap-pill is-primary" @click="openCreate">+ 新建小说</button>
  </div>
</header>

<div class="cap-card stories-toolbar" v-if="stories.length">
  <n-radio-group v-model:value="viewMode" size="small">
    <n-radio-button value="table">☰ 表格</n-radio-button>
    <n-radio-button value="cards">▦ 卡片</n-radio-button>
  </n-radio-group>
  <n-switch v-model:value="coverFilterSwitch" size="small">
    <template #checked>仅显示含封面</template>
    <template #unchecked>仅显示含封面</template>
  </n-switch>
</div>
```

`coverFilter` ref 是 `'all'|'with-cover'`，`coverFilterSwitch` 是布尔（toggle 用），二者通过 computed 双向桥接。

## 8. 错误处理矩阵

| 场景 | 后端 | 前端 |
|---|---|---|
| 文件 >2MB | multipart → 413 | n-upload `@before-upload` 提前拦截 |
| mime 非法 | 解析后校验 → 415 + unlink 已写临时文件 | accept 属性 + beforeUpload 双重把关 |
| DB 写失败（文件已落盘） | unlink 已写文件 + 500 | message.error + 列表不变 |
| DELETE /cover 但 coverUrl 已 null | 幂等返回 200 | 无感 |
| 删除 story 但 unlink 旧封面失败 | log.warn 不抛错 | 无感 |
| 孤儿文件残留（DB 已删但磁盘未删） | 本期容忍；follow-up 启动时扫 | 卡片 <img> 404 静默 |
| 标题含 emoji / 特殊字符 | 正常处理 | 印章 '?' 兜底 |
| coverUrl 被前端篡改成 `../../etc/passwd` | DB 已有值；@fastify/static 默认不跟随 `..` | 前端 regex 校验，非法不渲染 |

## 9. 测试策略

**首期补 vitest 脚手架**（按 CLAUDE.md 指示）：`apps/server/src/routes/__tests__/`。

**关键单测**（route 层 + Fastify inject + mock prisma）：

| 用例 | 文件 |
|---|---|
| PUT /:id：传 jpg → 写盘 + DB.update.coverUrl | `covers.test.ts` |
| PUT /:id：传 3MB → 413 | 同上 |
| PUT /:id：传 image/gif → 415 | 同上 |
| PUT /:id：传新文件 + removeCover=true → 旧文件先 unlink 再写新 | 同上 |
| DELETE /:id/cover：清字段 + unlink | 同上 |
| DELETE /:id/cover：coverUrl 已 null → 200 幂等 | 同上 |
| DELETE /:id：cascade 删 covers 目录 `{storyId}-*.*` | `stories.test.ts` |

**前端测试**：本期不做（CLAUDE.md 精神：项目整体测试空缺，组件小可人眼验证）。

## 10. 验证清单（声称完成前）

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm db:migrate && pnpm db:generate` ✅
- 手动冒烟：
  - 上传 <2MB jpg → 卡片显示
  - 上传 >2MB → 报错且不上传
  - 上传 image/gif → 报错
  - 移除封面 → 卡片回退到印章首字
  - 切换视图（表格 ↔ 卡片）→ localStorage 写入 + 刷新恢复
  - 切换过滤（仅含封面）→ 列表过滤 + 刷新恢复
  - 删除整本小说 → covers 目录对应文件消失

## 11. 代码原则（用户原话）

> "用合适的算法、代码即可，只是要注意代码是解耦的、易读的、可扩展的。"

落点：
- 后端 multipart 抽 plugin（`plugins/upload.ts`）；routes 只关心业务
- 前端视图/过滤抽 composable（`composables/useStoriesViewPrefs.ts`）；组件只关心渲染
- 印章算法抽 pure functions（`StoryCover.vue` 顶部）；零外部依赖，便于单测
- 文件命名/路径处理抽 helpers（`apps/server/src/lib/cover-storage.ts`）
- 不加无谓的抽象（CLAUDE.md 精神："Three similar lines is better than a premature abstraction"）