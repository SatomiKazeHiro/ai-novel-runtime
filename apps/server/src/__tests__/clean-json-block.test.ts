import { describe, it, expect } from 'vitest'
import { cleanJsonBlock } from '@novel-runtime/shared'

describe('cleanJsonBlock', () => {
  describe('happy path (compatible with existing behavior)', () => {
    it('strips ```json ... ``` wrapper', () => {
      const input = '```json\n{"a":1}\n```'
      expect(cleanJsonBlock(input)).toBe('{"a":1}')
    })

    it('returns plain JSON unchanged', () => {
      const input = '{"a":1}'
      expect(cleanJsonBlock(input)).toBe('{"a":1}')
    })

    it('handles surrounding whitespace', () => {
      const input = '\n  {"a":1}\n  '
      expect(cleanJsonBlock(input)).toBe('{"a":1}')
    })

    it('strips opening ```json on same line as content (no newline)', () => {
      const input = '```json{"a":1}```'
      expect(cleanJsonBlock(input)).toBe('{"a":1}')
    })
  })

  describe('bare fence (no language hint) — was broken before', () => {
    it('strips ``` ... ``` wrapper when no json language hint', () => {
      const input = '```\n{"a":1}\n```'
      expect(cleanJsonBlock(input)).toBe('{"a":1}')
    })

    it('strips bare fence with content on same line', () => {
      const input = '```{"a":1}```'
      expect(cleanJsonBlock(input)).toBe('{"a":1}')
    })
  })

  describe('truncated / incomplete fence detection', () => {
    it('throws when response starts with ```json but never closes', () => {
      // 用户的真实 bug 场景：responseContent 开头 ``` 但没有闭合
      const input = '```json\n{"a":1,"b"'
      expect(() => cleanJsonBlock(input)).toThrow(/未闭合|截断/)
    })

    it('throws when response starts with bare ``` but never closes', () => {
      const input = '```\n{"a":1,"b"'
      expect(() => cleanJsonBlock(input)).toThrow(/未闭合|截断/)
    })

    it('error message mentions maxTokens as a possible fix', () => {
      // 用户看到错误时，应该立刻知道下一步怎么试
      const input = '```json\n{"a":1'
      expect(() => cleanJsonBlock(input)).toThrow(/maxTokens/)
    })
  })

  describe('bare & character repair (AI returns literal & in JSON values)', () => {
    // 用户真实 bug：AI 把 "&" 当作"等等"占位符塞进 importance 字段，
    // 返回形如 {"importance": &, "type": "item"} 的非合法 JSON。
    // 修复策略：把"裸 &"（不是合法 HTML entity 的 &）包裹成 "&" 字符串，
    // 让 JSON.parse 能成功而不是抛错。
    it('wraps bare & in value position so JSON.parse succeeds', () => {
      // 用户的真实 responseContent 片段（含一个 & 在 importance 位置）
      const input = '{"type": "item", "importance": &, "key": "foo"}'
      const cleaned = cleanJsonBlock(input)
      expect(() => JSON.parse(cleaned)).not.toThrow()
      const parsed = JSON.parse(cleaned)
      expect(parsed.importance).toBe('&')
      expect(parsed.type).toBe('item')
    })

    it('repairs multiple bare & characters in same response', () => {
      // 用户描述"多个 &"的场景：AI 在多个字段里都用了 & 占位
      const input = '{"a": &, "b": 1, "c": &, "d": "x & y"}'
      const cleaned = cleanJsonBlock(input)
      expect(() => JSON.parse(cleaned)).not.toThrow()
    })

    it('does NOT touch & that begins a valid HTML entity (e.g. &amp; &lt; &gt; &quot;)', () => {
      // 合法 entity 必须保留原样，否则会把 &amp; 错误转成 &"" 破坏语义
      const input = '{"html": "Tom &amp; Jerry", "lt": "a &lt; b"}'
      const cleaned = cleanJsonBlock(input)
      expect(cleaned).toBe(input)  // 原样输出
      const parsed = JSON.parse(cleaned)
      expect(parsed.html).toBe('Tom &amp; Jerry')
      expect(parsed.lt).toBe('a &lt; b')
    })

    it('does NOT touch & that begins a numeric character reference (e.g. &#1234; &#xAB;)', () => {
      const input = '{"ref": "&#65;", "hex": "&#x41;"}'
      const cleaned = cleanJsonBlock(input)
      expect(cleaned).toBe(input)
      expect(() => JSON.parse(cleaned)).not.toThrow()
    })

    it('repairs bare & in real user response fragment (combined_extract context)', () => {
      // 用户实际 responseContent 截取的 0~200 字节（含 fence + importance 处的 &）
      const input = '```json\n{\n  "memories": {\n    "mainEvents": []\n  },\n  "graph": {\n    "nodes": [\n      {\n        "type": "item",\n        "importance": &,\n        "key": "tiandijiaozhengfu"\n      }\n    ],\n    "edges": []\n  }\n}\n```'
      const cleaned = cleanJsonBlock(input)
      expect(() => JSON.parse(cleaned)).not.toThrow()
      const parsed = JSON.parse(cleaned)
      expect(parsed.graph.nodes[0].importance).toBe('&')
    })
  })
})
