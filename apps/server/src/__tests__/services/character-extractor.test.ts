import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commitCharacterBranchStateWrites } from '../../services/character-extractor.js'
import type { CharacterStateRow } from '../../services/stages/character-stage.js'

describe('commitCharacterBranchStateWrites', () => {
  let tx: any
  beforeEach(() => {
    tx = {
      character: { create: vi.fn().mockResolvedValue({ id: 'new-char-id' }) },
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-1' }) }
    }
  })

  it('happy path: 1 matched + 2 isNew → 3 branchState.create + 2 character.create', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-1', name: '姜禾', key: 'jiang_he', status: '{"rank":"练气"}', relationships: '{}', costume: '', isNew: false },
      { characterId: null, name: '神秘女子', key: 'unknown', status: '{}', relationships: '{}', costume: '', isNew: true },
      { characterId: '', name: '路人甲', key: 'passerby', status: '{}', relationships: '{}', costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 1, writes)

    // 3 行 branchState 都入库 (1 matched + 2 自动建档后的)
    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(3)
    // 2 个 isNew 角色自动建档
    expect(tx.character.create).toHaveBeenCalledTimes(2)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyId: 'story-1',
        characterId: 'char-1',
        fromChapterNumber: 1,
        status: '{"rank":"练气"}',
        relationships: '{}',
        costume: null
      })
    })
  })

  it('all isNew: 自动建档 2 character + 2 branchState', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: 'X', key: 'x', status: '{}', relationships: '{}', costume: '', isNew: true },
      { characterId: null, name: 'Y', key: 'y', status: '{}', relationships: '{}', costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes)

    expect(tx.character.create).toHaveBeenCalledTimes(2)
    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(2)
  })

  it('mixed: 1 matched + 1 isNew → 2 branchState + 1 character.create', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-2', name: '许青', key: 'xu_qing', status: '{"rank":"筑基"}', relationships: '{"姜禾":"朋友"}', costume: '', isNew: false },
      { characterId: null, name: 'Z', key: 'z', status: '{}', relationships: '{}', costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 2, writes)

    expect(tx.character.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(2)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-2',
        fromChapterNumber: 2
      })
    })
  })

  // 实际 AI 输出 status 是 Object (JSON.parse 后), 不是 String。
  // 修前报错: "Argument `status`: Invalid value provided. Expected String, provided Object."
  // 修后边界统一 JSON.stringify, 同时不重复 stringify 已 String 的输入 (测试 fixture)。
  it('status / relationships 是 Object 时自动 JSON.stringify', async () => {
    const writes: CharacterStateRow[] = [
      {
        characterId: 'char-3',
        name: '林若',
        key: 'lin_ruo',
        status: { location: '许青家中', appearance: '穿着许青的衬衫', weapon: '长剑已收入剑鞘' },
        relationships: { '许青': '信任并接受其帮助' },
        costume: '',
        isNew: false
      }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 2, writes)

    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-3',
        fromChapterNumber: 2,
        status: JSON.stringify(writes[0].status),
        relationships: JSON.stringify(writes[0].relationships),
        costume: null
      })
    })
  })

  it('null Object 字段安全处理 (status=null → "null" 字符串, 不抛错)', async () => {
    const writes: CharacterStateRow[] = [
      {
        characterId: 'char-4',
        name: '空状态',
        key: 'empty',
        status: null as any,
        relationships: null as any,
        costume: '',
        isNew: false
      }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 3, writes)

    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-4',
        fromChapterNumber: 3,
        status: 'null',
        relationships: 'null',
        costume: null
      })
    })
  })
})

describe('commitCharacterBranchStateWrites - isNew auto-create', () => {
  let tx: any
  beforeEach(() => {
    tx = {
      character: { create: vi.fn().mockResolvedValue({ id: 'new-char-id' }) },
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-new' }) }
    }
  })

  it('isNew=true → 先 tx.character.create 再 tx.characterBranchState.create', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, costume: '黑袍', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes)

    expect(tx.character.create).toHaveBeenCalledTimes(1)
    expect(tx.character.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyId: 'story-1',
        slug: 'shenmi_ren',
        name: '神秘人',
        relationships: '{}',
        status: '{}'
      })
    })
    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'new-char-id',
        fromChapterNumber: 5,
        costume: '黑袍'
      })
    })
  })

  it('isNew=true + costume 空字符串 → costume: null', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '路人甲', key: 'passerby', status: {}, relationships: {}, costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes)

    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ costume: null })
    })
  })

  it('isNew=false → 不调 character.create,沿用 characterId', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'existing-id', name: '林凡', key: 'linfan', status: { rank: '筑基' }, relationships: {}, isNew: false }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes)

    expect(tx.character.create).not.toHaveBeenCalled()
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ characterId: 'existing-id' })
    })
  })
})
