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
})
