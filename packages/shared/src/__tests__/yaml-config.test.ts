import { describe, it, expect } from 'vitest'
import {
  RuntimeProfileYamlSchema,
  WorkerTaskYamlSchema,
  loadYaml,
  YamlLoadError,
  WORKER_TYPES
} from '../index.js'

/**
 * YAML 配置 schema + loader 治本测试.
 *
 * 覆盖:
 *   - docs/profiles/*.yaml 启动 init 时的 schema 校验
 *   - docs/worker-tasks/*.yaml 启动 init 时的 schema 校验
 *   - loadYaml 的 fail-fast 行为 (YAML 错 / schema 错都抛)
 */

describe('RuntimeProfileYamlSchema', () => {
  it('accepts a complete valid profile', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: '测试人格',
      identity: 'You are a test.',
      settings: {
        language: 'CN',
        uncensored: true,
        repeat: false,
        speciality: 'test'
      },
      behavior: 'behave well',
      jailbreak: null,
      isDefault: false
    })
    expect(result.success).toBe(true)
  })

  it('applies defaults (jailbreak=null, isDefault=false, settings.*)', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: 'Minimal',
      identity: 'You are minimal.',
      behavior: 'behave minimally'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.jailbreak).toBe(null)
      expect(result.data.isDefault).toBe(false)
      expect(result.data.settings.language).toBe('CN')
      expect(result.data.settings.uncensored).toBe(true)
      expect(result.data.settings.repeat).toBe(false)
      expect(result.data.settings.speciality).toBe('')
    }
  })

  it('rejects empty name', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: '',
      identity: 'x',
      behavior: 'y'
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty identity', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: 'x',
      identity: '',
      behavior: 'y'
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty behavior', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: 'x',
      identity: 'y',
      behavior: ''
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid language enum', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: 'x',
      identity: 'y',
      behavior: 'z',
      settings: { language: 'JP' }
    })
    expect(result.success).toBe(false)
  })

  it('strict mode: rejects extra top-level field', () => {
    const result = RuntimeProfileYamlSchema.safeParse({
      name: 'x',
      identity: 'y',
      behavior: 'z',
      notARealField: '!'
    })
    expect(result.success).toBe(false)
  })
})

describe('WorkerTaskYamlSchema', () => {
  it('accepts a complete valid task', () => {
    const result = WorkerTaskYamlSchema.safeParse({
      name: '[系统] 测试',
      workerType: 'generation',
      taskPrompt: 'do generation',
      enabled: true
    })
    expect(result.success).toBe(true)
  })

  it('applies default enabled=true', () => {
    const result = WorkerTaskYamlSchema.safeParse({
      name: 'x',
      workerType: 'scoring',
      taskPrompt: 'do scoring'
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.enabled).toBe(true)
  })

  it('rejects workerType not in the enum', () => {
    const result = WorkerTaskYamlSchema.safeParse({
      name: 'x',
      workerType: 'not-a-real-worker',
      taskPrompt: 'do'
    })
    expect(result.success).toBe(false)
  })

  it('WORKER_TYPES matches runtime-compiler contract', () => {
    // 钉死枚举值, runtime-compiler 的 WorkerTask.workerType 改了这里也得改.
    expect(WORKER_TYPES).toEqual([
      'generation', 'scoring', 'memory', 'graph',
      'timeline', 'rewrite', 'memory_organize'
    ])
  })
})

describe('loadYaml', () => {
  const source = 'test.yaml'

  it('parses + validates a complete YAML', () => {
    const text = `
name: 测试
identity: You are a test.
behavior: behave well
settings:
  language: CN
  uncensored: true
  repeat: false
  speciality: test
jailbreak: null
isDefault: false
`
    const data = loadYaml({ text, schema: RuntimeProfileYamlSchema, source })
    expect(data.name).toBe('测试')
    expect(data.settings.language).toBe('CN')
  })

  it('throws YamlLoadError on YAML syntax error', () => {
    const text = `
name: 'unclosed quote
identity: x
behavior: y
`
    expect(() => loadYaml({ text, schema: RuntimeProfileYamlSchema, source }))
      .toThrow(YamlLoadError)
  })

  it('throws YamlLoadError on empty YAML', () => {
    expect(() => loadYaml({ text: '', schema: RuntimeProfileYamlSchema, source }))
      .toThrow(/empty/i)
  })

  it('throws YamlLoadError on schema mismatch with field path', () => {
    const text = `
name: x
identity: ''
behavior: y
`
    try {
      loadYaml({ text, schema: RuntimeProfileYamlSchema, source })
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err).toBeInstanceOf(YamlLoadError)
      expect(err.message).toContain(source)
      expect(err.message).toContain('identity')
      expect(err.zodError).toBeDefined()
    }
  })

  it('throws YamlLoadError on type mismatch', () => {
    const text = `
name: x
identity: y
behavior: z
isDefault: "not a boolean"
`
    expect(() => loadYaml({ text, schema: RuntimeProfileYamlSchema, source }))
      .toThrow(YamlLoadError)
  })
})
