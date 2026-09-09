import { describe, it, expect } from 'vitest'
import { resolveAndCommitCharacterWrites, ConflictError } from '../../services/character-extractor.js'
import type { CharacterStateRow } from '../../services/stages/character-stage.js'

describe('resolveAndCommitCharacterWrites', () => {
  const existing = [
    { id: 'char-linfan', slug: 'linfan', name: '林凡' },
    { id: 'char-zhangsan', slug: 'zhangsan', name: '张三' }
  ]
  const tx: any = {}  // 该函数不直接写 DB

  it('slug+name 双匹配 → 命中,isNew=false', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(conflicts).toEqual([])
    expect(effectiveWrites[0].characterId).toBe('char-linfan')
    expect(effectiveWrites[0].isNew).toBe(false)
  })

  it('slug 命中 + name 不匹配 → conflict', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林峰', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toEqual([])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('slug_name_mismatch')
    expect(conflicts[0].existingCharacter?.name).toBe('林凡')
  })

  it('slug 未命中 → isNew=true', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: false }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(conflicts).toEqual([])
    expect(effectiveWrites[0].isNew).toBe(true)
    expect(effectiveWrites[0].characterId).toBe(null)
  })

  it('AI 未给 key → conflict(missing_key)', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '无名氏', key: '', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toEqual([])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('missing_key')
  })

  it('混合: 1 命中 + 1 新建 + 1 冲突', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '林峰', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(2)
    expect(conflicts).toHaveLength(1)
  })

  it('ConflictError 携带 conflicts 信息', () => {
    const err = new ConflictError([{ writeIndex: 0, reason: 'missing_key' }])
    expect(err.name).toBe('ConflictError')
    expect(err.conflicts).toHaveLength(1)
    expect(err.message).toContain('1 issues')
  })

  it('批内两个新角色同 slug → 第二条标 batch_duplicate_key（问题 A）', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(effectiveWrites[0].isNew).toBe(true)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('batch_duplicate_key')
    expect(conflicts[0].writeIndex).toBe(1)
    expect(conflicts[0].duplicateOfWriteIndex).toBe(0)
  })

  it('批内两条同 key 命中现有角色 → 第二条标 batch_duplicate_key（问题 B）', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(effectiveWrites[0].characterId).toBe('char-linfan')
    expect(effectiveWrites[0].isNew).toBe(false)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('batch_duplicate_key')
    expect(conflicts[0].duplicateOfWriteIndex).toBe(0)
  })

  it('三条同 key → 第 2、3 条都标 batch_duplicate_key，均指向第 1 条', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0].writeIndex).toBe(1)
    expect(conflicts[0].duplicateOfWriteIndex).toBe(0)
    expect(conflicts[1].writeIndex).toBe(2)
    expect(conflicts[1].duplicateOfWriteIndex).toBe(0)
  })

  it('空 key 与重复 key 混合 → missing_key 与 batch_duplicate_key 各自正确', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '无名氏', key: '', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0].reason).toBe('missing_key')
    expect(conflicts[0].writeIndex).toBe(0)
    expect(conflicts[1].reason).toBe('batch_duplicate_key')
    expect(conflicts[1].writeIndex).toBe(2)
    expect(conflicts[1].duplicateOfWriteIndex).toBe(1)
  })
})
