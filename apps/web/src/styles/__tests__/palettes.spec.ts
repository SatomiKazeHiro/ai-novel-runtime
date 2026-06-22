import { describe, it, expect } from 'vitest'
import { LIGHT_PALETTE, DARK_PALETTE, PALETTES, resolvePalette, type Palette } from '../tokens'

/**
 * PALETTES 完整性保障 — 治本测试.
 *
 * 治本约束:
 *   1) light 和 dark 必须有完全相同的字段集合, 加新色时 TS 类型会强制,
 *      但类型只覆盖到 LIGHT_PALETTE 声明那一层; 这个测试再额外兜底一遍,
 *      让"忘记给 dark 补一个字段"在 CI 阶段就报错.
 *   2) resolvePalette 行为正确.
 *   3) 每条 hex 是非空字符串(防御: 复制粘贴时漏写 #000000 之类).
 */

describe('PALETTES structure', () => {
  it('light and dark palettes have identical key sets', () => {
    const lightKeys = Object.keys(LIGHT_PALETTE).sort()
    const darkKeys = Object.keys(DARK_PALETTE).sort()
    expect(darkKeys, 'dark palette 缺少字段 — 加新色必须 light/dark 都填').toEqual(lightKeys)
  })

  it('PALETTES exposes exactly light + dark', () => {
    expect(Object.keys(PALETTES).sort()).toEqual(['dark', 'light'])
  })

  it('resolvePalette returns the correct palette for isDark boolean', () => {
    expect(resolvePalette(false)).toBe(LIGHT_PALETTE)
    expect(resolvePalette(true)).toBe(DARK_PALETTE)
  })
})

describe('palette field values', () => {
  /**
   * 任何 hex / rgba / 颜色字面量都不应该是空字符串,
   * 复制粘贴时漏写防御.
   */
  function assertNonEmpty(p: Palette, label: string) {
    for (const [key, value] of Object.entries(p)) {
      expect(value, `${label}.${key} 应该是非空字符串, 实际是 "${value}"`).toBeTruthy()
      expect(typeof value, `${label}.${key} 应该是 string`).toBe('string')
    }
  }

  it('light palette has no empty values', () => assertNonEmpty(LIGHT_PALETTE, 'LIGHT_PALETTE'))
  it('dark palette has no empty values', () => assertNonEmpty(DARK_PALETTE, 'DARK_PALETTE'))

  it('pureLight is #ffffff in both palettes (always-white semantic, NOT theme-flipped)', () => {
    // pureLight 用于 --text-on-accent / --text-on-dark, 必须永远白;
    // 与 pureWhite 不同 (pureWhite 在 dark 下变成 #2e2e2e 卡片色).
    // 改名/翻色都会导致 .cap-pill.is-primary 等 primary 按钮文字在暗色下变暗灰.
    expect(LIGHT_PALETTE.pureLight).toBe('#ffffff')
    expect(DARK_PALETTE.pureLight).toBe('#ffffff')
  })
})

describe('dark palette contrast guarantees', () => {
  // 暗色 canvas 必须够黑, 卡片必须明显比 canvas 亮, 边框也必须比卡片亮 —
  // 这是上一轮调试得出的暗色对比度硬约束, 用测试钉死防止回归.
  function hexBrightness(hex: string): number {
    // 支持 #rrggbb; rgba 跳过(无法精确比较亮度)
    const m = hex.match(/^#([0-9a-f]{6})$/i)
    if (!m) return -1
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 0xff
    const g = (n >> 8) & 0xff
    const b = n & 0xff
    // Rec. 709 luma
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  it('dark canvas (#141414) is darker than dark card (#2e2e2e)', () => {
    expect(hexBrightness(DARK_PALETTE.warmCream)).toBeLessThan(hexBrightness(DARK_PALETTE.pureWhite))
  })

  it('dark border is brighter than dark card (border floats off card)', () => {
    expect(hexBrightness(DARK_PALETTE.pebbleBorder)).toBeGreaterThan(hexBrightness(DARK_PALETTE.pureWhite))
  })

  it('dark accent (warm) is brighter than light accent (warm) — dark CTA pops more', () => {
    // Light terracotta #b8581e (~L37%) 在暗底上不够"跳",
    // dark terracotta 提到 L≥53% (e68a4d ≈ L60%) 才对得起 CTA 角色。
    expect(hexBrightness(DARK_PALETTE.warmAccent)).toBeGreaterThan(hexBrightness(LIGHT_PALETTE.warmAccent))
  })

  it('dark accent (cool) is brighter than light accent (cool) — link readable in dark', () => {
    // Light blueprint #4a5a7a 在 #141414 底上几乎隐形,
    // dark blueprint 提到 L≥56% (#7a8fb4 ≈ L57%) 才能当链接色。
    expect(hexBrightness(DARK_PALETTE.coolAccent)).toBeGreaterThan(hexBrightness(LIGHT_PALETTE.coolAccent))
  })
})