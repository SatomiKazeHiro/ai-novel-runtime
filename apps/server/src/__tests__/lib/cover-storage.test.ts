import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  resolveCoverPath,
  coverUrlToPath,
  saveCover,
  deleteCover,
  deleteCoversByStoryId
} from '../../lib/cover-storage.js'

describe('cover-storage', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'covers-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('resolveCoverPath', () => {
    it('returns covers/{storyId}-{ts}.{ext}', () => {
      const p = resolveCoverPath(root, 'abc-123', 1700000000000, 'jpg')
      expect(p).toBe(join(root, 'covers', 'abc-123-1700000000000.jpg'))
    })
  })

  describe('coverUrlToPath', () => {
    it('maps /uploads/covers/{uuid}-{ts}.jpg under root to absolute path', () => {
      const url = '/uploads/covers/97b9efa5-9cb4-4630-9d46-925ed0b08b2a-1700000000000.jpg'
      const abs = coverUrlToPath(root, url)
      expect(abs).toBe(join(root, 'covers', '97b9efa5-9cb4-4630-9d46-925ed0b08b2a-1700000000000.jpg'))
    })

    it('rejects URL with traversal characters', () => {
      expect(() => coverUrlToPath(root, '/uploads/../etc/passwd'))
        .toThrow(/invalid cover url/)
    })

    it('rejects URL outside /uploads/covers/', () => {
      expect(() => coverUrlToPath(root, '/uploads/other/foo.jpg'))
        .toThrow(/invalid cover url/)
    })

    it('rejects URL with non-hex chars in story id', () => {
      expect(() => coverUrlToPath(root, '/uploads/covers/notauuid-123.jpg'))
        .toThrow(/invalid cover url/)
    })
  })

  describe('saveCover', () => {
    it('writes file under root/covers and returns url', async () => {
      const url = await saveCover(root, '97b9efa5-9cb4-4630-9d46-925ed0b08b2a', 123, 'jpg', Buffer.from('abc'))
      expect(url).toBe('/uploads/covers/97b9efa5-9cb4-4630-9d46-925ed0b08b2a-123.jpg')
      expect(existsSync(join(root, 'covers', '97b9efa5-9cb4-4630-9d46-925ed0b08b2a-123.jpg'))).toBe(true)
    })

    it('creates covers dir if missing', async () => {
      await saveCover(root, '97b9efa5-9cb4-4630-9d46-925ed0b08b2a', 1, 'png', Buffer.from('x'))
      expect(existsSync(join(root, 'covers'))).toBe(true)
    })
  })

  describe('deleteCover', () => {
    it('removes existing file', async () => {
      const url = await saveCover(root, '97b9efa5-9cb4-4630-9d46-925ed0b08b2a', 1, 'jpg', Buffer.from('x'))
      await deleteCover(root, url)
      expect(existsSync(join(root, 'covers', '97b9efa5-9cb4-4630-9d46-925ed0b08b2a-1.jpg'))).toBe(false)
    })

    it('does not throw on missing file (idempotent)', async () => {
      await expect(deleteCover(root, '/uploads/covers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-99999.jpg'))
        .resolves.toBeUndefined()
    })

    it('does not throw on null url', async () => {
      await expect(deleteCover(root, null)).resolves.toBeUndefined()
    })
  })

  describe('deleteCoversByStoryId', () => {
    it('removes all files prefixed with storyId-', async () => {
      const idA = 'aaaaaaaa-1111-2222-3333-444444444444'
      const idB = 'bbbbbbbb-1111-2222-3333-444444444444'
      await saveCover(root, idA, 1, 'jpg', Buffer.from('a'))
      await saveCover(root, idA, 2, 'jpg', Buffer.from('b'))
      await saveCover(root, idB, 1, 'jpg', Buffer.from('c'))
      await deleteCoversByStoryId(root, idA)
      const files = readdirSync(join(root, 'covers'))
      expect(files).toEqual([`${idB}-1.jpg`])
    })
  })
})