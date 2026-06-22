/**
 * 颜色常量 —— JS/TS 端单一源, 与 tokens.css 一一对应.
 *
 * 双调色板设计 (PALETTES):
 *   - LIGHT_PALETTE / DARK_PALETTE 字段完全对应, 由 Palette 类型保证.
 *   - PALETTES = { light, dark } 提供给运行时分发; resolvePalette(isDark) 给单点查表.
 *   - naive-theme.ts 的 buildOverrides(palette) 工厂用同一套字段填 GlobalThemeOverrides.
 *     加新主题 (high-contrast / sepia / ...) 只需:
 *       1) tokens.ts 加一个 PALETTE 对象
 *       2) App.vue 加一个 mode 分支
 *     组件 / themeOverrides / tokens.css 都不用动.
 *
 * 同步约束:
 *   - 改任一 palette 的 hex 必须同步改 src/styles/tokens.css 的对应 :root 块.
 *   - 改 Palette 接口字段必须 light/dark 都填, TS 类型会强制.
 *
 * Reason: Naive UI themeOverrides / Cytoscape styles / SVG attribute
 * bindings cannot resolve CSS var() — they need literal hex.
 */

/* ============================================================
   共享字段结构 — light 和 dark 都必须实现这套字段, 由 TS 类型保证.
   ============================================================ */
export type Palette = {
  // === Surfaces ===
  warmCream: string
  pureWhite: string
  /** 永远 = #ffffff — "白字"语义, 不随主题翻. 与 pureWhite 不同: pureWhite 在 dark 下变成卡片色. */
  pureLight: string
  stoneGray: string
  stoneGrayPressed: string
  inkBlack: string
  inkBlackHover: string

  // === Borders & dividers ===
  pebbleBorder: string
  infoTint: string

  // === Text (3-tier grays) ===
  graphite: string
  midGray: string
  mutedAsh: string
  textDisabled: string
  textCaption: string
  placeholder: string
  placeholderDisabled: string

  // === Accents: warm (terracotta) ===
  warmAccent: string
  warmAccentHover: string
  warmAccentPressed: string
  warmAccentTint: string
  warmAccentTintLight: string
  warmAccentTintHover: string
  warmAccentTintPressed: string

  // === Accents: cool (blueprint) ===
  coolAccent: string
  coolAccentHover: string
  coolAccentPressed: string
  coolAccentTint: string
  coolAccentTintLight: string
  coolAccentTintPressed: string

  // === Accents: positive (sage) ===
  positive: string
  positiveHover: string
  positivePressed: string
  positiveTint: string

  // === Accents: error (calm red) ===
  error: string
  errorHover: string
  errorPressed: string
  errorTint: string
  errorTint10: string
  errorTintLight: string
  errorTintPressed: string
  errorTintFocus: string

  // === Accents: review (muted purple) ===
  review: string
  reviewTint: string

  // === Shadows ===
  focusRing: string
  shadowLight: string
  shadowMedium: string
  shadowStrong: string
  shadowButton: string

  // === Domain: chapter lifecycle ===
  chapterGenerating: string
  chapterGenerated: string
  chapterReviewing: string
  chapterFailed: string

  // === Domain: graph node types ===
  graphCharacter: string
  graphEvent: string
  graphFaction: string
  graphItem: string

  // === Domain: graph interaction ===
  graphNew: string
  graphEdge: string
  graphText: string
  graphSelected: string

  // === Domain: identity / loading ===
  protagonist: string
  skeletonEnd: string
}

/* ============================================================
   Light palette — boords 风格, cream 纸感 + 沉稳品牌色
   ============================================================ */
export const LIGHT_PALETTE: Palette = {
  // === Surfaces ===
  warmCream: '#fafaf5',
  pureWhite: '#ffffff',
  pureLight: '#ffffff',
  stoneGray: '#e9e9e7',
  stoneGrayPressed: '#d4d4d2',
  inkBlack: '#121212',
  inkBlackHover: '#2a2a2a',

  // === Borders ===
  pebbleBorder: '#cecdca',
  infoTint: '#dfe7f0',

  // === Text ===
  graphite: '#4d4d4d',
  midGray: '#7d7d7d',
  mutedAsh: '#898989',
  textDisabled: '#a8a8a8',
  textCaption: '#666666',
  placeholder: 'rgba(137, 137, 137, 0.85)',
  placeholderDisabled: 'rgba(137, 137, 137, 0.45)',

  // === Accents: warm (terracotta) ===
  warmAccent: '#b8581e',
  warmAccentHover: '#a04a18',
  warmAccentPressed: '#8a3f12',
  warmAccentTint: 'rgba(184, 88, 30, 0.12)',
  warmAccentTintLight: 'rgba(184, 88, 30, 0.06)',
  warmAccentTintHover: 'rgba(184, 88, 30, 0.18)',
  warmAccentTintPressed: 'rgba(184, 88, 30, 0.24)',

  // === Accents: cool (blueprint) ===
  coolAccent: '#4a5a7a',
  coolAccentHover: '#3a4a68',
  coolAccentPressed: '#2a3a58',
  coolAccentTint: 'rgba(74, 90, 122, 0.10)',
  coolAccentTintLight: 'rgba(74, 90, 122, 0.06)',
  coolAccentTintPressed: 'rgba(74, 90, 122, 0.12)',

  // === Accents: positive (sage) ===
  positive: '#5a7a4f',
  positiveHover: '#4a6a3f',
  positivePressed: '#3a5a2f',
  positiveTint: 'rgba(90, 122, 79, 0.12)',

  // === Accents: error (calm red) ===
  error: '#b94c4c',
  errorHover: '#a04040',
  errorPressed: '#803535',
  errorTint: 'rgba(185, 76, 76, 0.08)',
  errorTint10: 'rgba(185, 76, 76, 0.10)',
  errorTintLight: 'rgba(185, 76, 76, 0.06)',
  errorTintPressed: 'rgba(185, 76, 76, 0.12)',
  errorTintFocus: 'rgba(185, 76, 76, 0.04)',

  // === Accents: review ===
  review: '#7a4a6a',
  reviewTint: 'rgba(122, 74, 106, 0.12)',

  // === Shadows ===
  focusRing: 'rgba(184, 88, 30, 0.30)',
  shadowLight: 'rgba(18, 18, 18, 0.04)',
  shadowMedium: 'rgba(18, 18, 18, 0.06)',
  shadowStrong: 'rgba(18, 18, 18, 0.08)',
  shadowButton: 'rgba(0, 0, 0, 0.10)',

  // === Domain: chapter lifecycle ===
  chapterGenerating: '#a04a18',
  chapterGenerated: '#5a7a4f',
  chapterReviewing: '#7a4a6a',
  chapterFailed: '#b94c4c',

  // === Domain: graph node types (高饱和, 40px 圆点上可辨) ===
  graphCharacter: '#4080d0',
  graphEvent: '#e07a2a',
  graphFaction: '#d66060',
  graphItem: '#a05cc0',

  // === Domain: graph interaction ===
  graphNew: '#5a8a4f',
  graphEdge: '#94a3b8',
  graphText: '#64748b',
  graphSelected: '#d4a04a',

  // === Domain: identity / loading ===
  protagonist: '#d4a04a',
  skeletonEnd: '#f4ede0'
}

/* ============================================================
   Dark palette — surface/text/border/accent 全部独立调过
   关键设计:
   - canvas / card / border 拉开 12-20 灰度, 让卡片浮出
   - 次级文本 c8→d8 / 88→a8, 暗底小字号也能读
   - warmAccent / coolAccent 在 dark 下提亮一档 (L≈37%→53%),
     在 #141414 底上保持品牌 hue 但作为 CTA / 链接更"跳"
   ============================================================ */
export const DARK_PALETTE: Palette = {
  // === Surfaces (拉大 canvas ↔ card 距离) ===
  warmCream: '#141414',
  pureWhite: '#2e2e2e',
  pureLight: '#ffffff',
  stoneGray: '#3a3a3a',
  stoneGrayPressed: '#454545',
  inkBlack: '#f0f0f0',
  inkBlackHover: '#d8d8d8',

  // === Borders ===
  pebbleBorder: '#4a4a4a',
  infoTint: '#1f2a3a',

  // === Text (二级 c8→d8, 三级 88→a8) ===
  graphite: '#d8d8d8',
  midGray: '#a8a8a8',
  mutedAsh: '#888888',
  textDisabled: '#666666',
  textCaption: '#a0a0a0',
  placeholder: 'rgba(168, 168, 168, 0.85)',
  placeholderDisabled: 'rgba(168, 168, 168, 0.45)',

  // === Accents: warm (提亮一档, hue 保持) ===
  warmAccent: '#d97a3a',
  warmAccentHover: '#e68a4d',
  warmAccentPressed: '#c46a30',
  warmAccentTint: 'rgba(217, 122, 58, 0.18)',
  warmAccentTintLight: 'rgba(217, 122, 58, 0.10)',
  warmAccentTintHover: 'rgba(217, 122, 58, 0.24)',
  warmAccentTintPressed: 'rgba(217, 122, 58, 0.32)',

  // === Accents: cool (提亮一档, 链接清晰可读) ===
  coolAccent: '#7a8fb4',
  coolAccentHover: '#8da0c2',
  coolAccentPressed: '#6a7ea2',
  coolAccentTint: 'rgba(122, 143, 180, 0.18)',
  coolAccentTintLight: 'rgba(122, 143, 180, 0.10)',
  coolAccentTintPressed: 'rgba(122, 143, 180, 0.24)',

  // === Accents: positive (sage 在暗底上提亮) ===
  positive: '#8ab07f',
  positiveHover: '#9cc090',
  positivePressed: '#7aa06f',
  positiveTint: 'rgba(138, 176, 127, 0.18)',

  // === Accents: error (calm red 提亮) ===
  error: '#e89090',
  errorHover: '#f0a0a0',
  errorPressed: '#d88080',
  errorTint: 'rgba(232, 144, 144, 0.16)',
  errorTint10: 'rgba(232, 144, 144, 0.20)',
  errorTintLight: 'rgba(232, 144, 144, 0.10)',
  errorTintPressed: 'rgba(232, 144, 144, 0.24)',
  errorTintFocus: 'rgba(232, 144, 144, 0.06)',

  // === Accents: review ===
  review: '#c084d8',
  reviewTint: 'rgba(192, 132, 216, 0.16)',

  // === Shadows (dark 背景下用更深 alpha, 浅阴影看不出) ===
  focusRing: 'rgba(217, 122, 58, 0.45)',
  shadowLight: 'rgba(0, 0, 0, 0.20)',
  shadowMedium: 'rgba(0, 0, 0, 0.40)',
  shadowStrong: 'rgba(0, 0, 0, 0.60)',
  shadowButton: 'rgba(0, 0, 0, 0.30)',

  // === Domain: chapter lifecycle (提亮以适配暗底) ===
  chapterGenerating: '#e68a4d',
  chapterGenerated: '#8ab07f',
  chapterReviewing: '#c084d8',
  chapterFailed: '#e89090',

  // === Domain: graph node types (dark variant — 提亮 + 降 chroma, 暗底可读) ===
  graphCharacter: '#5b95e0',
  graphEvent: '#f0a560',
  graphFaction: '#e89090',
  graphItem: '#c084d8',

  // === Domain: graph interaction ===
  graphNew: '#8ab07f',
  graphEdge: '#94a3b8',
  graphText: '#a8b8c8',
  graphSelected: '#e8b870',

  // === Domain: identity / loading ===
  protagonist: '#e8b870',
  skeletonEnd: '#2f2f2f'
}

/* ============================================================
   Public exports
   ============================================================ */

/** 全调色板表 —— 给 themeOverrides / cytoscape / SVG attribute 查表用. */
export const PALETTES = { light: LIGHT_PALETTE, dark: DARK_PALETTE } as const
export type PaletteKey = keyof typeof PALETTES

/** 单点查表 helper —— 组件里直接 `resolvePalette(themeStore.isDark)`. */
export function resolvePalette(isDark: boolean): Palette {
  return isDark ? DARK_PALETTE : LIGHT_PALETTE
}

/** 向后兼容: 旧代码 `import { COLOR } from '.../tokens'` 仍指向 light palette. */
export const COLOR = LIGHT_PALETTE
export type ColorKey = keyof typeof COLOR