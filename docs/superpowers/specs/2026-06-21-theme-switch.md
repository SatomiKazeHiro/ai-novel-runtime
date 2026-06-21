# Theme Switch (light / dark / system) — Design Spec

**Goal:** 把现有的"主题切换 UI 写了但 UI 层没接通"问题解决,并实现 dark mode 的三面适配(CSS 变量 / Naive UI 组件 / cytoscape canvas),让三个面在 light / dark / system 三种模式下都正确响应,代码可读、易维护、易扩展。

> 范围:接通的不仅是当前 UI,而是 dark mode 的完整链路。

---

## 1. 现状

`apps/web/src/stores/theme.ts` 已经是完整的 pinia store:
- `mode: 'light' | 'dark' | 'system'`
- `isDark` computed
- `setMode()` 写 `localStorage['novel-runtime:theme']`
- 监听 `prefers-color-scheme` 变化

`apps/web/src/components/NavBar.vue` 已经有 UI(`<n-radio-group>` 三选项)。

**但 App.vue 没接通**:
```vue
<n-config-provider :theme-overrides="themeOverrides" ...>
```
没有 `:theme="isDark ? darkTheme : null"`,**切换不生效**。`tokens.css` 是单一 `:root` 块,**没有 dark 变体**。`useCytoscapeLifecycle` 颜色是字面量,**cytoscape 节点在 dark mode 下仍是亮色**。

**还有一个 bug**: `theme.ts` 的 system 监听里
```ts
if (mode.value === 'system') mode.value = 'system'
```
值没变,Vue ref 不会触发响应式更新,**这条 listener 实际无效**。系统主题切换时不会触发 isDark 重算。

## 2. 目标

1. **接通主题**: `isDark` 变化驱动三面同时响应
2. **三面适配完整**: CSS 变量 + Naive UI + cytoscape 都跟着切
3. **代码易扩展**: 加新主题(高对比度 / 复古)时核心逻辑零改动,只补配置
4. **代码易读**: 主题相关配置集中,不散落在多个 .vue 文件

**非目标**(本期不做):
- 主题切换的过渡动画(用户没要求)
- Naive UI 组件的 per-component 颜色微调(用 `darkThemeOverrides` 整体覆盖,不全量自定义)
- 自动跟随系统的瞬时延迟优化(`prefers-color-scheme` 用 `addEventListener` 即可,debounce 不在本期)

## 3. 设计决策

### 3.1 三面的实现策略(用户已确认)

| 面 | 策略 | 数据流 |
|---|---|---|
| **CSS 变量** | `:root[data-theme="dark"]` 块重定义 ~10 个关键变量,其他继承 | watch `isDark` → 设 `document.documentElement.dataset.theme` |
| **Naive UI** | 用 naive-ui 自带 `darkTheme` + 自定义 `darkThemeOverrides` | `n-config-provider` 的 `:theme` + `:theme-overrides` 跟 `isDark` 切换 |
| **Cytoscape** | `useCytoscapeLifecycle` 接受 `isDark` ref,颜色用函数式 `(ele) => isDark.value ? dark : light` | cytoscape 重绘时调函数,瞬时取新色,无重建 |

### 3.2 tokens.css 轻量化 dark 调色板(用户已确认)

`tokens.css` 已经是单一 `:root` 块。加 dark 变体的两种方案:
- **方案 A** (采用):在 `tokens.css` 末尾加 `:root[data-theme="dark"]` 块,只重定义关键 surface / text / border / shadow 变量(~10 个)。其他 ~40 个变量继承。**变量名不变,组件 `var(--bg-card)` 不动,值自动跟着翻**。
- 方案 B (否决):拆 `tokens-light.css` + `tokens-dark.css`,按主题动态 import。跨文件难以对比,加新色要同时改两份,反而难维护。

**采用方案 A 的依据**:用户偏好"轻量化、可读性高",dark 模式在 boords 风格下接近 light 的反相,绝大多数颜色逻辑通用,只有 surface / text / border / shadow 翻一下。

### 3.3 Naive UI dark 主题(用户已确认)

- 用 naive-ui 自带 `darkTheme` + 自定义 `darkThemeOverrides`(颜色逻辑与 `lightOverrides` 共享,surface 调暗)
- 不自建 dark theme 对象(避免工作量加倍)
- **关键组织决策**:`lightOverrides` + `darkOverrides` 抽到 `apps/web/src/styles/naive-theme.ts`,App.vue 缩成接入层。App.vue 当前 640+ 行是反模式 — 主题相关色值不应混在根组件。

### 3.4 cytoscape 适配(用户已确认)

- `useCytoscapeLifecycle` 接受 `isDark?: Ref<boolean>` 参数(可选,不传则维持当前行为,向后兼容)
- 颜色用 cytoscape 的**函数式 style**:
  ```ts
  'background-color': (ele) => isDark.value
    ? DARK_NODE_COLORS[normalizeType(ele.data('type'))]
    : getNodeColor(ele.data('type'))
  ```
- 切换瞬时生效,无重建,状态(选中 / 聚焦 / 缩放)不丢
- 不引入 setStyle() / fromJson() 补丁更新接口(API 复杂,状态分散)

### 3.5 store 的 system 监听 bug 修复

`theme.ts` 的 listener 改成:
```ts
mediaQuery.addEventListener('change', () => {
  // 触发 isDark 重新计算: mode 没变但系统主题变了
  // 用一个 dummy ref 触发 / 或者改用 setMode 但要避免覆盖 localStorage
  if (mode.value === 'system') {
    // Vue ref 相同值不触发, 显式触发响应式
    forceUpdateTick.value++  // 加一个 ref, 配合 isDark 里读它
  }
})
```

或者更干净:
```ts
const isDark = computed(() => {
  if (mode.value === 'system') return getSystemDark()
  return mode.value === 'dark'
})
// 直接 setMode('system') 不行, 会重写 localStorage(虽然值没变)
// 改用: 引入 reactive 的 modeRef, 在 isDark 里读它
```

最终方案:让 `isDark` 在 system 模式下每次都现读 `getSystemDark()`,系统主题变化时不需要 mode 变,而是 `isDark` 自己重算。Vue computed 依赖追踪会自动在 `getSystemDark` 被调用时重算吗?不会 — 因为 `getSystemDark` 不是 reactive 的。**真正干净的方案**:

```ts
// system 主题变化时, isDark 必须重算 — 显式依赖一个 reactive tick
const systemTick = ref(0)  // 仅作触发器
const isDark = computed(() => {
  // 读 systemTick 触发响应式追踪
  void systemTick.value
  if (mode.value === 'system') return getSystemDark()
  return mode.value === 'dark'
})
mediaQuery.addEventListener('change', () => {
  systemTick.value++  // 触发 isDark 重算
})
```

这样 system 主题变化时,`isDark` 自动重算,**所有 watcher 跟着响应**。`mode` 没变,`localStorage` 不动。

## 4. 文件改动清单

| 文件 | 状态 | 改动 | 净行数 |
|---|---|---|---|
| `apps/web/src/stores/theme.ts` | **改** | 加 `systemTick` ref;`isDark` 读 tick;listener 改用 `systemTick++`;移除无效的 `mode.value = 'system'` | +5 / -1 |
| `apps/web/src/styles/tokens.css` | **改** | 末尾加 `:root[data-theme="dark"]` 块,~10 个变量重定义 | +25 |
| `apps/web/src/styles/tokens.ts` | **改** | 加 6 个 `*Dark` 字段(4 graph 节点色 + graphNew + graphSelected) | +10 |
| `apps/web/src/styles/naive-theme.ts` | **新** | 导出 `lightOverrides` + `darkOverrides`(从 App.vue 搬) | +600 / -600 (搬到新文件) |
| `apps/web/src/App.vue` | **改** | 缩到接入层:`<n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">`;watch `isDark` 设 `data-theme`;移除内联 `themeOverrides`(导入) | 净 -580 |
| `apps/web/src/composables/graph/useCytoscapeLifecycle.ts` | **改** | `CytoscapeLifecycleOptions` 加 `isDark?: Ref<boolean>`;函数式颜色读 `isDark.value` | +15 |
| `apps/web/src/components/graph/GraphView.vue` | **改** | 调用 `useCytoscapeLifecycle` 时传 `isDark: computed(() => themeStore.isDark)` | +3 |
| `apps/web/src/components/graph/EditableGraph.vue` | **改** | 同上 | +3 |
| `apps/web/src/stores/__tests__/theme.spec.ts` | **新** | 测试 mode 切换 / isDark 重算 / localStorage / systemTick 触发 | +80 |
| `apps/web/src/styles/__tests__/tokens.spec.ts` | **新** | 双文件同步断言(light 与 dark 块同名变量一致) | +50 |

**净行数**: 25+10+600+(-580)+15+3+3+4+80+50 ≈ **+210 行**(其中生产代码 ~50 行,测试 ~130 行,主题拆分搬运 +600/-580 抵消)

**不动**:
- `apps/web/src/components/NavBar.vue`(UI 已存在,只接 `themeStore` 已接好,不动)
- `apps/web/src/stores/story.ts` / 其他 store
- 任何 view / component 的颜色用法(`var(--bg-card)` 已经走 CSS 变量,自动跟着切)
- 后端代码

## 5. 关键文件预览

### 5.1 `stores/theme.ts` (修复后)

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'novel-runtime:theme'

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'system')

  // system 主题变化时,isDark 必须重算;用一个 ref 当 trigger 让 Vue 追踪到
  const systemTick = ref(0)

  const isDark = computed(() => {
    void systemTick.value  // 触发响应式追踪
    if (mode.value === 'system') return getSystemDark()
    return mode.value === 'dark'
  })

  function setMode(m: ThemeMode) {
    mode.value = m
    localStorage.setItem(STORAGE_KEY, m)
  }

  // 监听系统主题变化 — 触发 isDark 重算,不动 localStorage
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', () => {
    if (mode.value === 'system') systemTick.value++
  })

  return { mode, isDark, setMode }
})
```

### 5.2 `styles/tokens.css` 末尾新增

```css
/* === Dark mode — 轻量化,只翻 surface / text / border / shadow 关键变量 ===
   加新变量时,只在 :root 加;如果 dark 模式需要特殊调,再补进这里。 */
:root[data-theme="dark"] {
  --color-warm-cream: #1a1a1a;
  --color-pure-white: #2a2a2a;
  --color-stone-gray: #353535;
  --color-stone-gray-pressed: #404040;
  --color-ink-black: #f0f0f0;
  --color-ink-black-hover: #d8d8d8;
  --color-pebble-border: #3a3a3a;
  --color-graphite: #c8c8c8;
  --color-mid-gray: #888888;
  --color-muted-ash: #6a6a6a;
  --color-text-disabled: #555555;
  /* shadow-* 继承 light 即可,dark 阴影的 rgba alpha 实际是更弱的视觉,不动 */
}
```

### 5.3 `App.vue` 改动

```vue
<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <!-- ... -->
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useThemeStore } from './stores/theme'
import { lightOverrides, darkOverrides } from './styles/naive-theme'
import { darkTheme, /* ... 其他 */ } from 'naive-ui'

const themeStore = useThemeStore()
const naiveTheme = computed(() => themeStore.isDark ? darkTheme : null)
const themeOverrides = computed(() => themeStore.isDark ? darkOverrides : lightOverrides)

// 把主题状态写到 :root 的 data-theme,让 tokens.css 的 [data-theme="dark"] 块生效
watch(() => themeStore.isDark, (dark) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}, { immediate: true })
</script>
```

### 5.4 `useCytoscapeLifecycle.ts` 改动

```ts
export interface CytoscapeLifecycleOptions {
  // ... 现有字段
  isDark?: Ref<boolean>  // 新增
}

// 在 buildCytoscapeStyle 或 init 内部, 颜色用函数式:
const nodeBgColor = (ele: any) => {
  const type = ele.data('type')
  return options.isDark?.value
    ? DARK_NODE_COLORS[normalizeType(type)] || COLOR.graphEdge
    : getNodeColor(type)
}
```

`DARK_NODE_COLORS` 是 `useCytoscapeLifecycle` 内部的 `Record<NormalizedType, string>`,从 `tokens.ts` 读:
```ts
// tokens.ts 新增:
graphCharacterDark: '#5b95e0',
graphEventDark: '#f0a560',
graphFactionDark: '#e89090',
graphItemDark: '#c084d8',
graphNewDark: '#8ab07f',         // 略亮, dark 背景下需要更明显
graphSelectedDark: '#e8b870',    // 略亮

// useCytoscapeLifecycle.ts 内部:
const DARK_NODE_COLORS: Record<string, string> = {
  character: COLOR.graphCharacterDark,
  faction:   COLOR.graphFactionDark,
  event:     COLOR.graphEventDark,
  item:      COLOR.graphItemDark,
}
```

`normalizeType` 已经在 useCytoscapeLifecycle.ts 里实现,直接用。

## 6. 测试

### 6.1 `stores/__tests__/theme.spec.ts` (新增)

- 初始 mode 从 localStorage 读
- `setMode('light')` 后 `isDark.value === false`
- `setMode('dark')` 后 `isDark.value === true`
- `setMode('system')` 后 `isDark.value` 跟随系统
- system 模式 + 系统主题变化 → `isDark` 自动重算
- `setMode` 写 localStorage
- 多次 `setMode('light')` 不写重复 key(或写同样值,OK)

### 6.2 `styles/__tests__/tokens.spec.ts` (新增)

- light 与 dark 块同名变量名一致(每个变量要么都不定义,要么两个块都定义)
- 同一变量在 light 与 dark 块的值不相等(如果相等,说明没必要为它重定义)
- 浅色模式下 dark 块的变量不应该被使用(白盒检查 — 暂时不做,只做前两项)

### 6.3 不测

- Naive UI 集成(外部库)
- CSS 变量值(视觉验证)
- cytoscape 函数式 style(逻辑简单,人工 review)

## 7. 易扩展性

### 加新主题(例如 high-contrast / sepia)

- `tokens.css` 加 `[data-theme="hc"]` 块(~10 行)
- `styles/naive-theme.ts` 加 `hcOverrides`(可复制 `darkOverrides` 改 surface 颜色)
- `ThemeMode` 加 `'hc'` 值
- NavBar 渲染第 4 个 radio button

核心逻辑(`useThemeStore` / `App.vue` 接入层 / `useCytoscapeLifecycle`)**0 改动**。

### 加新颜色

- `tokens.css` 的 `:root` 加变量;`tokens.ts` 加 `as const` 字段
- dark 模式需要特殊调时,再补进 `:root[data-theme="dark"]` 块(可继承则不补)

### 加新 domain token(如"事件类型")

- `tokens.css` 加 `--color-event-catastrophe: ...`
- `tokens.ts` 加 `eventCatastrophe: '...'`
- 组件里 `var(--color-event-catastrophe)` 用,无 JS 字面量
- 如果该 token 在 cytoscape / Naive UI 等 JS 端用,加 `eventCatastropheDark` 字段(同 5.4 的模式),dark 模式自动跟上

### 调整 cytoscape 节点色

- 改 `tokens.ts` 的 `graphCharacter` (light) 或 `graphCharacterDark` (dark) 即可
- 改 `tokens.css` 的 `--color-graph-character` (light) 或 `:root[data-theme="dark"]` 块里的对应变量
- `useCytoscapeLifecycle` **0 改动**(颜色从 `tokens.ts` 拉,不走硬编码)

## 8. 风险

- **Naive UI darkThemeOverrides 工作量未知**:naive-ui dark theme 需要重定义 ~30 个字段(Button/Card/Input/Menu/DataTable 等)。如果 `darkOverrides` 写得不全,某些组件在 dark 模式下可能颜色不一致。**对策**:用 App.vue 当前 `themeOverrides` 的结构作为模板,逐组件复制一份改 surface 颜色,工作量 ~150 行。
- **cytoscape 节点色 dark 对比度**:light 模式下 4 个 graph 节点色都是高饱和度,可能在 dark 背景下不够亮。**对策**:在 tokens.ts 的 `*Dark` 字段上调高 lightness(例如 `#4080d0` → `#5b95e0`),实施时先在 dev 跑一遍看效果。
- **light 模式被破坏**:本次改动动 App.vue 接入层,有回归风险。**对策**:写完跑 `pnpm dev` 验证 light 模式视觉不变。

## 9. 不在本期

- 主题切换的过渡动画(`transition: background-color 0.2s ease` on body)— 用户没要求
- Per-component dark mode 调优(例如 DataTable 的条纹 / hover)— 用 naive-ui defaults 即可
- 跟随系统的瞬时延迟优化(debounce)— `prefers-color-scheme` listener 自身开销小,debounce 不必要

## 10. 实施顺序

1. **修 theme.ts bug**(独立,1 文件,15 行,1 单测)
2. **加 tokens.css dark 块 + tokens.ts *Dark 字段**(2 文件,~40 行)
3. **抽 naive-theme.ts + 改 App.vue**(2 文件,-580/+30 净行)
4. **加 theme.spec.ts 单测**(1 文件,80 行,验证 1-3)
5. **加 tokens.spec.ts 单测**(1 文件,50 行,验证 2)
6. **改 useCytoscapeLifecycle + 2 个调用处**(3 文件,~25 行)
7. **pnpm typecheck + pnpm dev 验证**

每步独立可提交(commit 1: fix system listener;commit 2: dark tokens;commit 3: naive-theme split;...)。
