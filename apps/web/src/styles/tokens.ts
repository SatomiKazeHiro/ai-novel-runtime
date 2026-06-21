/**
 * 颜色常量 —— JS/TS 端单一源, 与 tokens.css 一一对应.
 *
 * 为什么需要这个文件:
 *   1) Naive UI 的 themeOverrides 通过 seemly 解析颜色, 不支持 var() 引用.
 *   2) Cytoscape 的 stylesheet 在 canvas 渲染时用 JS 解析颜色, 不走 CSS 变量.
 *   3) SVG attribute (fill="..." / stroke="...") 不解析 var(), 只有 inline style 才解析.
 *
 * 凡是 hex 必须出现在 JS 字面量里的场景(themeOverrides / cytoscape / SVG attribute
 * 绑定), 都从这里 import, 不要再写裸 hex.
 *
 * 同步约束:
 *   - 改这个文件的 hex 必须同步改 src/styles/tokens.css 里对应的 --color-* 变量.
 *   - 改 tokens.css 必须同步改这个文件.
 *   - 两个文件都集中在 src/styles/ 下, 一目了然.
 */

export const COLOR = {
  // === Surfaces ===
  warmCream: '#fafaf5',
  pureWhite: '#ffffff',
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

  // === Accents (warm/cool/positive/error/review) ===
  warmAccent: '#b8581e',
  warmAccentHover: '#a04a18',
  warmAccentPressed: '#8a3f12',
  warmAccentTint: 'rgba(184, 88, 30, 0.12)',
  warmAccentTintLight: 'rgba(184, 88, 30, 0.06)',
  warmAccentTintHover: 'rgba(184, 88, 30, 0.18)',
  warmAccentTintPressed: 'rgba(184, 88, 30, 0.24)',

  coolAccent: '#4a5a7a',
  coolAccentHover: '#3a4a68',
  coolAccentPressed: '#2a3a58',
  coolAccentTint: 'rgba(74, 90, 122, 0.10)',
  coolAccentTintLight: 'rgba(74, 90, 122, 0.06)',
  coolAccentTintPressed: 'rgba(74, 90, 122, 0.12)',

  positive: '#5a7a4f',
  positiveHover: '#4a6a3f',
  positivePressed: '#3a5a2f',
  positiveTint: 'rgba(90, 122, 79, 0.12)',

  error: '#b94c4c',
  errorHover: '#a04040',
  errorPressed: '#803535',
  errorTint: 'rgba(185, 76, 76, 0.08)',
  errorTint10: 'rgba(185, 76, 76, 0.10)',
  errorTintLight: 'rgba(185, 76, 76, 0.06)',
  errorTintPressed: 'rgba(185, 76, 76, 0.12)',
  errorTintFocus: 'rgba(185, 76, 76, 0.04)',

  review: '#7a4a6a',
  reviewTint: 'rgba(122, 74, 106, 0.12)',

  focusRing: 'rgba(184, 88, 30, 0.30)',
  shadowLight: 'rgba(18, 18, 18, 0.04)',
  shadowMedium: 'rgba(18, 18, 18, 0.06)',
  shadowStrong: 'rgba(18, 18, 18, 0.08)',
  shadowButton: 'rgba(0, 0, 0, 0.10)',

  // === Domain: chapter lifecycle ===
  chapterGenerating: '#a04a18', // = warmAccentHover
  chapterGenerated: '#5a7a4f',  // = positive
  chapterReviewing: '#7a4a6a',  // = review
  chapterFailed: '#b94c4c',     // = error

  // === Domain: graph node types (vibrant 70-80% chroma, distinguishable on 40px circles) ===
  // Each sits in the same hue family as a brand accent but at higher chroma
  // and lightness so the node reads as "brighter signal" against the cream
  // background, not "muted extension of brand".
  //   event (warm orange) = brighter relative of --color-warm-accent (terracotta)
  //   character (sky blue) = brighter relative of --color-cool-accent (blueprint)
  //   faction (coral red) = brighter relative of --color-error (calm red)
  //   item (lavender) = brighter relative of --color-review (muted purple)
  graphCharacter: '#4080d0',  // sky blue
  graphEvent: '#e07a2a',       // warm orange
  graphFaction: '#d66060',     // coral red
  graphItem: '#a05cc0',        // lavender

  // === Domain: graph interaction ===
  graphNew: '#5a8a4f',         // muted forest
  graphEdge: '#94a3b8',        // cool slate gray
  graphText: '#64748b',        // edge label text
  graphSelected: '#d4a04a',    // muted amber

  // === Domain: graph node types — DARK variants ===
  // Light 节点色在 dark 背景下读不清; 提高 lightness + 降 chroma。
  // Cytoscape canvas 渲染需要 JS 字面量, 所以双份。
  // 必须与 tokens.css 的 :root[data-theme="dark"] 块里 --color-graph-* 字段同步。
  graphCharacterDark: '#5b95e0',
  graphEventDark: '#f0a560',
  graphFactionDark: '#e89090',
  graphItemDark: '#c084d8',
  graphNewDark: '#8ab07f',
  graphSelectedDark: '#e8b870',

  // === Domain: identity / loading ===
  protagonist: '#d4a04a',      // gold star (distinct from graph event)
  skeletonEnd: '#f4ede0'
} as const

export type ColorKey = keyof typeof COLOR
