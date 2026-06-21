import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// tokens.css 是手写文件, 这里用正则解析出 :root 与 :root[data-theme="dark"] 块。
// 不引 css-tree/postcss 这种重依赖。

const TOKENS_PATH = resolve(__dirname, '../tokens.css')

function extractBlock(content: string, selector: string): Map<string, string> {
  // 匹配: selector { ... }, 块内允许任意嵌套 (深一层或同层)
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm')
  const match = content.match(re)
  if (!match) return new Map()

  const body = match[1]
  const varRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  const result = new Map<string, string>()
  let m: RegExpExecArray | null
  while ((m = varRe.exec(body)) !== null) {
    result.set(m[1].trim(), m[2].trim())
  }
  return result
}

function normalize(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

describe('tokens.css light/dark sync', () => {
  const content = readFileSync(TOKENS_PATH, 'utf-8')
  const light = extractBlock(content, ':root')
  const dark = extractBlock(content, ':root[data-theme="dark"]')

  it('both blocks parse to non-empty maps', () => {
    expect(light.size).toBeGreaterThan(20)
    expect(dark.size).toBeGreaterThan(5)
  })

  it('every variable defined in dark block is also defined in light block', () => {
    // 防御: 加了 dark 字段但忘了加 light, 或反之
    for (const key of dark.keys()) {
      expect(light.has(key), `dark 块声明了 ${key} 但 light 块没有`).toBe(true)
    }
  })

  it('variables redefined in dark block have a different value than light', () => {
    // 防御: dark 块重定义了某变量但值跟 light 一样 — 冗余, 应该删掉
    const redundant: string[] = []
    for (const [key, darkValue] of dark.entries()) {
      const lightValue = light.get(key)
      if (lightValue !== undefined && normalize(lightValue) === normalize(darkValue)) {
        redundant.push(`${key} = ${lightValue}`)
      }
    }
    expect(redundant, `以下变量在 dark 块重定义但值跟 light 一致, 应删除:\n  ${redundant.join('\n  ')}`).toEqual([])
  })

  it('dark block has at least one surface / text / border override', () => {
    // smoke test: 确认 dark 块不是空 stub
    const expected = ['--color-warm-cream', '--color-pure-white', '--color-ink-black']
    for (const key of expected) {
      expect(dark.has(key), `dark 块缺关键字段 ${key}`).toBe(true)
    }
  })
})