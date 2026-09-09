import { describe, it, expect, vi } from 'vitest'
import { fetchCharacterDisplay } from '../../services/character-display.js'

describe('fetchCharacterDisplay', () => {
  it('空 story → 返回空数组', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const result = await fetchCharacterDisplay(prisma, 'story-empty', null)
    expect(result).toEqual([])
  })

  it('无 snapshot → 三字段都为 null, base 值通过 character 表读', async () => {
    const prisma: any = {
      character: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: true,
          identity: '["青云弟子"]', appearance: '[]', temperament: '["冷静"]',
          personality: '["谨慎"]', speechStyle: '[]',
          relationships: '{"张三":"师兄"}', status: '{"realm":"筑基"}'
        }])
      },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', null)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('林凡')
    expect(result[0].relationships).toBe(null)
    expect(result[0].status).toBe(null)
    expect(result[0].costume).toBe(null)
  })

  it('默认模式 (chapter=null): 三字段各自取"最新有数据"快照', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      // Prisma orderBy fromChapterNumber desc 返回顺序: [7, 5, 3]
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 7, status: null, relationships: null, costume: '黑衣' },
        { characterId: 'c1', fromChapterNumber: 5, status: '{"realm":"金丹"}', relationships: '{"李四":"好友"}', costume: '白袍' },
        { characterId: 'c1', fromChapterNumber: 3, status: '{"realm":"筑基"}', relationships: '{"李四":"朋友"}', costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', null)
    const row = result[0]
    // relationships: 第 7 章 null → 退到第 5 章 → '好友'
    expect(row.relationships?.value).toEqual({ '李四': '好友' })
    expect(row.relationships?.sourceChapterNumber).toBe(5)
    // status: 第 7 章 null → 退到第 5 章 → 金丹
    expect(row.status?.value).toEqual({ realm: '金丹' })
    expect(row.status?.sourceChapterNumber).toBe(5)
    // costume: 第 7 章 '黑衣'
    expect(row.costume?.value).toBe('黑衣')
    expect(row.costume?.sourceChapterNumber).toBe(7)
  })

  it('指定 chapter=N: 统一显示该章数据, 无则该字段 null', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 3, status: '{"realm":"筑基"}', relationships: '{"李四":"朋友"}', costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', 3)
    const row = result[0]
    expect(row.relationships?.value).toEqual({ '李四': '朋友' })
    expect(row.relationships?.sourceChapterNumber).toBe(3)
    expect(row.status?.value).toEqual({ realm: '筑基' })
    expect(row.status?.sourceChapterNumber).toBe(3)
    expect(row.costume).toBe(null)  // 第 3 章无 costume
  })

  it('指定 chapter=N, 但 character 在该章无 snapshot → 字段均为 null', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 5, status: '{"a":1}', relationships: null, costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', 3)
    expect(result[0].relationships).toBe(null)
    expect(result[0].status).toBe(null)
    expect(result[0].costume).toBe(null)
  })

  it('JSON 字符串解析失败 → 该字段 null,不抛错', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 1, status: 'invalid json{{{', relationships: '{"a":1}', costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', 1)
    expect(result[0].status).toBe(null)
    expect(result[0].relationships?.value).toEqual({ a: 1 })
  })

  it('latestSnapshotChapter = 角色最新快照章, 与 viewChapterNumber 无关', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      // Prisma orderBy fromChapterNumber desc 返回顺序: [7, 5, 3]
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 7, status: null, relationships: null, costume: '黑衣' },
        { characterId: 'c1', fromChapterNumber: 5, status: '{"realm":"金丹"}', relationships: '{"李四":"好友"}', costume: '白袍' },
        { characterId: 'c1', fromChapterNumber: 3, status: '{"realm":"筑基"}', relationships: '{"李四":"朋友"}', costume: null }
      ]) }
    }
    // 默认模式: 最新快照章 = 7(desc 第一个), 即便 relationships 只在第 5 章有数据
    expect((await fetchCharacterDisplay(prisma, 's1', null))[0].latestSnapshotChapter).toBe(7)
    // 指定章模式: 也不受影响, 仍是角色级最新快照章
    expect((await fetchCharacterDisplay(prisma, 's1', 3))[0].latestSnapshotChapter).toBe(7)
  })

  it('无 snapshot → latestSnapshotChapter = null', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    expect((await fetchCharacterDisplay(prisma, 's1', null))[0].latestSnapshotChapter).toBe(null)
  })
})
