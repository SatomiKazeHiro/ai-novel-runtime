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
      { characterId: 'char-1', name: '姜禾', key: 'jiang_he', status: '{"rank":"练气"}', relationships: '{}', isNew: false },
      { characterId: null, name: '神秘女子', key: 'unknown', status: '{}', relationships: '{}', isNew: true },
      { characterId: '', name: '路人甲', key: 'passerby', status: '{}', relationships: '{}', isNew: true }
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
      { characterId: null, name: 'X', key: 'x', status: '{}', relationships: '{}', isNew: true },
      { characterId: null, name: 'Y', key: 'y', status: '{}', relationships: '{}', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 5, writes, log)

    expect(tx.characterBranchState.create).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledTimes(2)
  })

  it('mixed: 1 matched + 1 isNew → create 1 次', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-2', name: '许青', key: 'xu_qing', status: '{"rank":"筑基"}', relationships: '{"姜禾":"朋友"}', isNew: false },
      { characterId: null, name: 'Z', key: 'z', status: '{}', relationships: '{}', isNew: true }
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
})