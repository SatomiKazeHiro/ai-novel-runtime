import { promises as fs } from 'fs'
import { join, normalize, sep } from 'path'

const URL_RE = /^\/uploads\/covers\/([a-f0-9-]+-\d+\.(jpg|png|webp))$/

export type CoverExt = 'jpg' | 'png' | 'webp'

export function resolveCoverPath(root: string, storyId: string, ts: number, ext: CoverExt): string {
  return join(root, 'covers', `${storyId}-${ts}.${ext}`)
}

export function coverUrlToPath(root: string, url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(URL_RE)
  if (!m) throw new Error(`invalid cover url: ${url}`)
  const rel = join('covers', m[1])
  const abs = normalize(join(root, rel))
  const expected = normalize(join(root, 'covers') + sep)
  if (!abs.startsWith(expected) && abs !== expected) {
    throw new Error(`invalid cover url: ${url}`)
  }
  return abs
}

export async function saveCover(
  root: string,
  storyId: string,
  ts: number,
  ext: CoverExt,
  data: Buffer
): Promise<string> {
  const dir = join(root, 'covers')
  await fs.mkdir(dir, { recursive: true })
  const abs = resolveCoverPath(root, storyId, ts, ext)
  await fs.writeFile(abs, data)
  return `/uploads/covers/${storyId}-${ts}.${ext}`
}

export async function deleteCover(root: string, url: string | null | undefined): Promise<void> {
  const abs = coverUrlToPath(root, url)
  if (!abs) return
  try {
    await fs.unlink(abs)
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }
}

export async function deleteCoversByStoryId(root: string, storyId: string): Promise<void> {
  const dir = join(root, 'covers')
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err: any) {
    if (err.code === 'ENOENT') return
    throw err
  }
  const prefix = `${storyId}-`
  await Promise.all(
    files.filter(f => f.startsWith(prefix)).map(f =>
      fs.unlink(join(dir, f)).catch(() => undefined)
    )
  )
}