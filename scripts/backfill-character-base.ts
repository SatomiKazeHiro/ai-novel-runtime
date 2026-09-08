import { PrismaClient } from '@prisma/client'

/**
 * 一次性脚本: 把每个 Character 的最新 CharacterBranchState 的 relationships/status
 * 回填到 Character 表的 base 字段。
 *
 * 用法 (一次性, 部署时跑一次):
 *   pnpm db:backfill-character-base
 *
 * 幂等性: 重复跑会把 base 设回第一次跑时的"最新"值。如已手动调整过 base 字段,
 * 不要重复跑(可手动 revert 该 character)。
 *
 * 风险: 大库(>1000 character)时 findMany 全量拉可能慢;若性能瓶颈,
 * 按 storyId 分批或加 ?sinceChapterNumber 限定范围。
 */

const prisma = new PrismaClient()

async function main() {
  const characters = await prisma.character.findMany({
    select: { id: true, slug: true, name: true }
  })
  let updated = 0
  let skipped = 0

  await prisma.$transaction(async (tx) => {
    for (const c of characters) {
      const latest = await tx.characterBranchState.findFirst({
        where: { characterId: c.id },
        orderBy: { fromChapterNumber: 'desc' }
      })
      if (!latest) {
        skipped++
        continue
      }
      await tx.character.update({
        where: { id: c.id },
        data: {
          relationships: latest.relationships,
          status: latest.status
        }
      })
      updated++
    }
  })

  console.log(`[backfill-character-base] updated=${updated}, skipped=${skipped}, total=${characters.length}`)
}

main()
  .catch((e) => {
    console.error('[backfill-character-base] failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
