/**
 * V2 章节号分配器 — 单一真相源。
 *
 * 当前 V2 仅主线（无 parentChapterId / isSideStory 字段）：
 * - 主线下一章 = max(number) + 1；无章节 = 1
 *
 * 设计预留（Q14-D 决策）：函数签名已为树结构留口（parentChapterId + isSideStory 参数）。
 * 未来 Q14-C 扩展时：
 *   1. schema V2Chapter 加 parentChapterId: String? + isSideStory: Boolean @default(false)
 *   2. migration
 *   3. 把下方的 TODO stub 替换为真实实现
 *
 * 当前实现：主线分支是唯一可达路径；isSideStory=true 抛错（schema 未就绪）。
 */

export interface AllocateNextNumberParams {
  storyId: string
  parentChapterId?: string
  isSideStory?: boolean
}

export async function allocateNextNumber(
  prisma: any,
  params: AllocateNextNumberParams
): Promise<number> {
  const { storyId, parentChapterId, isSideStory } = params

  // 番外模式：当前 schema 还不支持，防御性抛错
  if (isSideStory) {
    throw new Error('V2 当前不支持番外章节（isSideStory 模式未启用，待 Q14-C 扩展）')
  }

  // TODO Q14-C: 从指定父章节续
  //   number = lastChild ? lastChild.number + 1 : parent.number + 1
  //   where: { storyId, parentChapterId }
  //   需 schema 加 V2Chapter.parentChapterId 字段
  if (parentChapterId) {
    throw new Error('V2 当前不支持从指定父章节续（parentChapterId 模式未启用，待 Q14-C 扩展）')
  }

  // 主线无父：全局 max + 1（V2 当前唯一路径）
  const last = await prisma.v2Chapter.findFirst({
    where: { storyId },
    orderBy: { number: 'desc' }
  })
  return last ? Math.floor(last.number) + 1 : 1
}