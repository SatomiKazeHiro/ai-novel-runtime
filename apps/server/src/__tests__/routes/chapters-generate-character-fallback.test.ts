import { describe, it, expect, vi } from 'vitest'
import { getCharactersWithLatestState } from '../../routes/chapters-generate.js'

/**
 * v4 角色管理重构 — base 字段 prompt 注入 fallback 链测试。
 *
 * fallback 链: snapshot (CharacterBranchState) > Character base 字段 > '{}'
 * - 让新建但未归档的角色也能在 prompt 注入基础关系/状态
 * - 让 snapshot 优先覆盖 base(避免 base 覆盖已归档的更新)
 */

describe('getCharactersWithLatestState — base 字段 fallback 链', () => {
  it('有 latestState snapshot → 用 snapshot,覆盖 base', async () => {
    const prisma: any = {
      character: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: true,
            identity: '["青云弟子"]', appearance: '[]', temperament: '[]',
            personality: '["谨慎"]', speechStyle: '[]',
            relationships: '{"base":"张三是师兄"}',  // base
            status: '{"base":"筑基"}'
          }
        ])
      },
      characterBranchState: {
        findFirst: vi.fn().mockResolvedValue({
          characterId: 'c1', fromChapterNumber: 5,
          relationships: '{"snapshot":"李四是朋友"}',
          status: '{"snapshot":"金丹"}'
        })
      }
    }
    const result = await getCharactersWithLatestState(prisma, 's1')
    expect(result[0].relationships).toBe('{"snapshot":"李四是朋友"}')
    expect(result[0].status).toBe('{"snapshot":"金丹"}')
  })

  it('无 snapshot 但 base 有值 → fallback 到 base', async () => {
    const prisma: any = {
      character: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
            identity: '[]', appearance: '[]', temperament: '[]',
            personality: '[]', speechStyle: '[]',
            relationships: '{"张三":"师兄"}',
            status: '{"realm":"筑基"}'
          }
        ])
      },
      characterBranchState: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    }
    const result = await getCharactersWithLatestState(prisma, 's1')
    expect(result[0].relationships).toBe('{"张三":"师兄"}')
    expect(result[0].status).toBe('{"realm":"筑基"}')
  })

  it("无 snapshot 且 base 也 null → fallback 到 '{}'", async () => {
    const prisma: any = {
      character: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
            identity: '[]', appearance: '[]', temperament: '[]',
            personality: '[]', speechStyle: '[]',
            relationships: null,
            status: null
          }
        ])
      },
      characterBranchState: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    }
    const result = await getCharactersWithLatestState(prisma, 's1')
    expect(result[0].relationships).toBe('{}')
    expect(result[0].status).toBe('{}')
  })

  it('混合: 同一 story 内,部分有 snapshot + 部分无', async () => {
    // 设计意图: 每个 character 独立判断。
    // commitCharacterBranchStateWrites 写入时 JSON.stringify 永远非 null,
    // 所以行存在时字段必有值。?? 只在行不存在 (latestState 为 null) 时落到 base。
    const prisma: any = {
      character: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', slug: 'a', name: 'A', identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]', relationships: '{"base-a":"x"}', status: '{"base-a":"y"}' },
          { id: 'c2', slug: 'b', name: 'B', identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]', relationships: '{"base-b":"x"}', status: null }
        ])
      },
      characterBranchState: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where.characterId === 'c1') return Promise.resolve({ status: '{"snap-a":"z"}', relationships: '{"snap-rel":"r"}' })  // 行存在 → 都用 snapshot
          if (where.characterId === 'c2') return Promise.resolve(null)  // 行不存在 → fallback base
          return Promise.resolve(null)
        })
      }
    }
    const result = await getCharactersWithLatestState(prisma, 's1')
    // A: snapshot 行存在 → status / relationships 都用 snapshot
    expect(result[0].status).toBe('{"snap-a":"z"}')
    expect(result[0].relationships).toBe('{"snap-rel":"r"}')
    // B: 无 snapshot → base 命中 relationships;status 是 null → '{}'
    expect(result[1].relationships).toBe('{"base-b":"x"}')
    expect(result[1].status).toBe('{}')
  })

  it('空 story → 返回空数组', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findFirst: vi.fn() }
    }
    const result = await getCharactersWithLatestState(prisma, 'empty')
    expect(result).toEqual([])
  })
})
