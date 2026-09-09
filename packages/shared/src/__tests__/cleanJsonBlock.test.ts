import { describe, it, expect } from 'vitest'
import { cleanJsonBlock } from '../index.js'

/**
 * cleanJsonBlock — AI JSON 响应清洗. 历史 fix 覆盖:
 *   - markdown fence 边界剥离 (```json / ```)
 *   - 不闭合 fence 抛清晰错误 (而非静默吞掉)
 *   - value 位置"裸 &"包成字符串 (user bug 2026-05)
 *
 * 新增 fix (2026-06-26):
 *   - value 位置 HTML entity (`&xxx;` 或 `&xxx;7` 形式) 整段包成字符串
 *   - LLM 在 web/HTML 训练数据里学到"value 用 entity 表达特殊字符"的坏习惯,
 *     之前只 cover 裸 & 不 cover 多字符 entity
 *
 * 不能破坏的 case (回归保护):
 *   - 字符串内部的 "&" (e.g. "Tom & Jerry")
 *   - 字符串内部的 HTML entity (e.g. "5 &lt; 10")
 *   - 字符串内部完整 "&xxx;" (e.g. "&amp;" 作为字符串值)
 *   - 合法 JSON 数字 (5, 7.5)
 */

describe('cleanJsonBlock — AI JSON repair', () => {
  describe('value position: HTML entity (2026-06-26 fix)', () => {
    it('repairs {"importance": &nbsp;7} — entity followed by digit', () => {
      // 用户真实 case: AI 把 non-breaking space 当 number 前缀
      const raw = '{"importance": &nbsp;7}'
      const fixed = cleanJsonBlock(raw)
      expect(JSON.parse(fixed)).toEqual({ importance: '&nbsp;7' })
    })

    it('repairs value position &amp; (entity with semicolon)', () => {
      const fixed = cleanJsonBlock('{"a": &amp;}')
      expect(JSON.parse(fixed)).toEqual({ a: '&amp;' })
    })

    it('repairs value position &amp (entity without semicolon)', () => {
      const fixed = cleanJsonBlock('{"a": &amp}')
      expect(JSON.parse(fixed)).toEqual({ a: '&amp' })
    })

    it('repairs entity in array position', () => {
      const fixed = cleanJsonBlock('[1, 2, &nbsp;]')
      expect(JSON.parse(fixed)).toEqual([1, 2, '&nbsp;'])
    })

    it('repairs entity in nested array inside object', () => {
      const fixed = cleanJsonBlock('{"a": [&nbsp;]}')
      expect(JSON.parse(fixed)).toEqual({ a: ['&nbsp;'] })
    })

    it('handles full payload structure (user full case)', () => {
      const raw = '{"memories":{"mainEvents":[{"description":"测试","importance": &nbsp;7}]}}'
      const fixed = cleanJsonBlock(raw)
      expect(JSON.parse(fixed)).toEqual({
        memories: { mainEvents: [{ description: '测试', importance: '&nbsp;7' }] }
      })
    })
  })

  describe('value position: bare & (legacy 2026-05 fix — must not regress)', () => {
    it('still repairs bare & wrapped by terminators', () => {
      // 用户原始 case (2026-05): {"importance": &, ...}
      // 当前 fix 是 `replace(/([:,\[]\s*?)&(\s*?[,\]}])/g, '$1"&"$2')`
      const fixed = cleanJsonBlock('{"a": &, "b": 1}')
      expect(JSON.parse(fixed)).toEqual({ a: '&', b: 1 })
    })
  })

  describe('does NOT touch & inside strings (regression guard)', () => {
    it('preserves & inside string value ("Tom & Jerry")', () => {
      const fixed = cleanJsonBlock('{"a": "Tom & Jerry"}')
      expect(JSON.parse(fixed)).toEqual({ a: 'Tom & Jerry' })
    })

    it('preserves HTML entity inside string ("5 &lt; 10")', () => {
      const fixed = cleanJsonBlock('{"a": "5 &lt; 10"}')
      expect(JSON.parse(fixed)).toEqual({ a: '5 &lt; 10' })
    })

    it('preserves full entity string ("&amp;")', () => {
      const fixed = cleanJsonBlock('{"a": "&amp;"}')
      expect(JSON.parse(fixed)).toEqual({ a: '&amp;' })
    })
  })

  describe('does NOT touch valid JSON', () => {
    it('passes plain numbers through', () => {
      expect(JSON.parse(cleanJsonBlock('{"a": 5}'))).toEqual({ a: 5 })
    })

    it('passes nested structures through', () => {
      const obj = { a: { b: [1, 'two', null] }, c: true }
      expect(JSON.parse(cleanJsonBlock(JSON.stringify(obj)))).toEqual(obj)
    })
  })

  describe('markdown fence handling (existing behavior — regression guard)', () => {
    it('strips ```json fence pair and parses inner JSON', () => {
      const fixed = cleanJsonBlock('```json\n{"a":1}\n```')
      expect(JSON.parse(fixed)).toEqual({ a: 1 })
    })

    it('throws on unclosed fence (response truncated mid-JSON)', () => {
      // 用户真实场景: maxTokens 不够, AI 输出被截断
      expect(() => cleanJsonBlock('```json\n{"a":1,"b":'))
        .toThrow(/未闭合|截断|maxTokens/)
    })
  })
})