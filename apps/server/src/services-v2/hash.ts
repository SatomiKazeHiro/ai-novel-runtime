// V2 正文 SHA256 哈希 — 阶段 4 使用

import { createHash } from 'node:crypto'

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}
