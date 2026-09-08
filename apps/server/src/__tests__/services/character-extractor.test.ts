import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commitCharacterBranchStateWrites } from '../../services/character-extractor.js'
import type { CharacterStateRow } from '../../services/stages/character-stage.js'

describe('commitCharacterBranchStateWrites', () => {
  let tx: any
  let log: { info: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    log = { info: vi.fn() }
    tx = {
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-1' }) }
    }
  })

  it('happy path: 只对 isNew=false + characterId 有效的条目 create', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-1', name: '姜禾', key: 'jiang_he', status: '{"rank":"练气"}', relationships: '{}', costume: '', isNew: false },
      { characterId: null, name: '神秘女子', key: 'unknown', status: '{}', relationships: '{}', costume: '', isNew: true },
      { characterId: '', name: '路人甲', key: 'passerby', status: '{}', relationships: '{}', costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 1, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: {
        characterId: 'char-1',
        fromChapterNumber: 1,
        status: '{"rank":"练气"}',
        relationships: '{}'
      }
    })
    // isNew 的两条都跳过 + log
    expect(log.info).toHaveBeenCalledTimes(2)
  })

  it('all isNew: create 不被调', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: 'X', key: 'x', status: '{}', relationships: '{}', costume: '', isNew: true },
      { characterId: null, name: 'Y', key: 'y', status: '{}', relationships: '{}', costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 5, writes, log)

    expect(tx.characterBranchState.create).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledTimes(2)
  })

  it('mixed: 1 matched + 1 isNew → create 1 次', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-2', name: '许青', key: 'xu_qing', status: '{"rank":"筑基"}', relationships: '{"姜禾":"朋友"}', costume: '', isNew: false },
      { characterId: null, name: 'Z', key: 'z', status: '{}', relationships: '{}', costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 2, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
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

    await commitCharacterBranchStateWrites(tx, 2, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: {
        characterId: 'char-3',
        fromChapterNumber: 2,
        status: JSON.stringify(writes[0].status),
        relationships: JSON.stringify(writes[0].relationships)
      }
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

    await commitCharacterBranchStateWrites(tx, 3, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: {
        characterId: 'char-4',
        fromChapterNumber: 3,
        status: 'null',
        relationships: 'null'
      }
    })
  })
})