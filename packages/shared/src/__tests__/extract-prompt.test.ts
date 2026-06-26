import { describe, it, expect } from 'vitest'
import { buildExtractPrompt, PREV_SNAPSHOT_INVENTORY_CAP } from '../extract-prompt.js'

/**
 * buildExtractPrompt — pure function. Tests live in packages/shared (true
 * source) rather than apps/server (where combined-extractor.ts lives) so:
 *   - prompt 文字改了只改这里, 验证即时反映
 *   - 不需要 mock runtime-loader / callAIWithLog / resolveProvider 这些 AI 层
 *   - 解耦: shared 包自己保证自己的 contract, server 包只是 consumer
 */

const baseInput = {
  protagonistNames: ['李凡', '赵若曦'],
  existingNodeKeys: ['character:zhangsan', 'faction:qingmeng'],
  previousSnapshotNodes: [] as Array<{ type: string; key: string; label: string }>,
  content: 'content',
  outline: 'outline'
}

describe('buildExtractPrompt — mode=full (cross-chapter injection)', () => {
  it('injects N-1 entity list into prompt when previousSnapshot has nodes', () => {
    const prev = [
      { type: 'character', key: 'zhangsan', label: '张三' },
      { type: 'faction',   key: 'qingmeng',  label: '青盟' }
    ]
    const prompt = buildExtractPrompt({ ...baseInput, previousSnapshotNodes: prev }, { mode: 'full' })

    expect(prompt).toContain('N-1 全局图谱中的实体清单')
    expect(prompt).toContain('character:zhangsan (张三)')
    expect(prompt).toContain('faction:qingmeng (青盟)')
  })

  it('omits N-1 inventory block when previousSnapshot is empty', () => {
    const prompt = buildExtractPrompt(
      { ...baseInput, previousSnapshotNodes: [] },
      { mode: 'full' }
    )
    expect(prompt).not.toContain('N-1 全局图谱中的实体清单')
  })

  it('caps N-1 inventory at PREV_SNAPSHOT_INVENTORY_CAP nodes (defensive)', () => {
    // Interleaved: 400 high-importance (crit_*) + 400 low-importance (filler_*),
    // total 800. With correct descending sort by importance (the function sorts
    // by importance desc and trims by cap), all 400 crit_* (importance 10)
    // survive plus 100 filler_* (importance 0) fill the rest → 400 crit + 100 filler.
    // Without sort: slice(0,500) gives interleaved 250/250, so the crit_* count
    // assertion (400) would FAIL.
    const nodes: Array<{ type: string; key: string; label: string; importance: number }> = []
    for (let i = 0; i < 400; i++) {
      nodes.push({ type: 'character', key: `crit_${i}`,   label: `C${i}`, importance: 10 })
      nodes.push({ type: 'character', key: `filler_${i}`, label: `F${i}`, importance: 0 })
    }
    const prompt = buildExtractPrompt({ ...baseInput, previousSnapshotNodes: nodes }, { mode: 'full' })

    expect((prompt.match(/character:crit_\d+/g) || []).length).toBe(400)
    expect((prompt.match(/character:filler_\d+/g) || []).length).toBe(100)
    expect((prompt.match(/character:\w+_\d+/g) || []).length).toBe(PREV_SNAPSHOT_INVENTORY_CAP)
  })

  it('does NOT inject existing arcs (handled by plot-consolidator v2 worker)', () => {
    // v2 设计: extractAll 不再喂 existing arcs 给 AI, 跨章弧线融合
    // 由 plot-consolidator 自己读章节 + DB existing arcs 做语义级判断。
    const prompt = buildExtractPrompt(baseInput, { mode: 'full' })
    expect(prompt).not.toContain('现有弧线')
    expect(prompt).not.toContain('李凡修仙之路')
  })
})

describe('buildExtractPrompt — mode=slim (chapter-fact-only)', () => {
  it('omits N-1 inventory block even when previousSnapshot has nodes', () => {
    const prev = [{ type: 'character', key: 'zhangsan', label: '张三' }]
    const prompt = buildExtractPrompt({ ...baseInput, previousSnapshotNodes: prev }, { mode: 'slim' })

    expect(prompt).not.toContain('N-1 全局图谱中的实体清单')
    expect(prompt).not.toContain('character:zhangsan (张三)')
  })

  it('omits existing arcs prompt section (cross-chapter fusion is worker concern)', () => {
    const prompt = buildExtractPrompt(baseInput, { mode: 'slim' })
    expect(prompt).not.toContain('现有弧线')
    // slim 模式提示 AI: 剧情弧线分析由独立 worker 负责
    expect(prompt).toMatch(/剧情弧线分析由独立的 plot-consolidator worker/)
  })

  it('omits existingNodeKeys line (no cross-chapter entity reuse hint)', () => {
    const prompt = buildExtractPrompt(
      { ...baseInput, existingNodeKeys: ['character:zhangsan', 'faction:qingmeng'] },
      { mode: 'slim' }
    )
    // full 模式会拼 "已有实体（不要重复提取...）: character:zhangsan, faction:qingmeng"
    // slim 模式根本不消费 existingNodeKeys
    expect(prompt).not.toMatch(/已有实体.*character:zhangsan/)
  })

  it('retains node quality constraint block (chapter-fact-only still cares)', () => {
    const prompt = buildExtractPrompt(baseInput, { mode: 'slim' })
    expect(prompt).toContain('节点质量约束')
    expect(prompt).toContain('路人甲乙丙')
  })

  it('default mode is slim when no options passed', () => {
    const prev = [{ type: 'character', key: 'zhangsan', label: '张三' }]
    const prompt = buildExtractPrompt({ ...baseInput, previousSnapshotNodes: prev })
    // 没传 options → 默认 slim → 不含 N-1 注入
    expect(prompt).not.toContain('N-1 全局图谱中的实体清单')
  })
})