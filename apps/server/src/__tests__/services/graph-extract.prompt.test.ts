import { describe, it, expect } from 'vitest'
import { buildGraphExtractPrompt } from '../../services/stages/graph-extract.prompt.js'

describe('buildGraphExtractPrompt — 实体+关系上下文', () => {
  const base = {
    content: '本章姜禾拿出剑，许青帮她适应现代生活',
    characterNames: ['姜禾', '许青'],
    prevCumulativeGraphNodes: [
      { type: 'character', key: 'jiang_he', label: '姜禾' },
      { type: 'character', key: 'xu_qing', label: '许青' },
      { type: 'item', key: 'jianghe_peijian', label: '盐帮佩剑' },
      { type: 'event', key: 'jiang_he_chuan_yue', label: '姜禾穿越' }
    ],
    prevCumulativeGraphEdges: [
      { fromType: 'character', fromKey: 'jiang_he', toType: 'item', toKey: 'jianghe_peijian', relation: '持有' },
      { fromType: 'character', fromKey: 'jiang_he', toType: 'event', toKey: 'jiang_he_chuan_yue', relation: '参与' },
      { fromType: 'character', fromKey: 'xu_qing', toType: 'event', toKey: 'help_adapt', relation: '参与' }
    ]
  }

  it('按正文出现的 character 组织关系上下文', () => {
    const prompt = buildGraphExtractPrompt(base)
    expect(prompt).toContain('姜禾(character:jiang_he)')
    expect(prompt).toContain('持有-item:jianghe_peijian')
    expect(prompt).toContain('许青(character:xu_qing)')
  })

  it('正文未出现的角色不进上下文', () => {
    const prompt = buildGraphExtractPrompt({
      ...base,
      content: '本章只有姜禾出现'
    })
    expect(prompt).not.toContain('许青(character:xu_qing)')
  })

  it('含增量抽取约束', () => {
    const prompt = buildGraphExtractPrompt(base)
    expect(prompt).toContain('新增')
  })
})
