import { describe, expect, it, vi } from 'vitest'
import { fetchCharacterDisplay } from '../../services/character-display.js'

describe('character display contract', () => {
  it('does not copy base relationship/status into snapshot fields', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', relationships: '{"ally":"friend"}', status: '{"realm":"one"}', identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]' }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const [row] = await fetchCharacterDisplay(prisma, 's1', null)
    expect(row.relationships).toBe(null)
    expect(row.status).toBe(null)
    expect(row.baseRelationships).toEqual({ ally: 'friend' })
    expect(row.baseStatus).toEqual({ realm: 'one' })
  })
})
