#!/usr/bin/env node
// verify-extract-prompt-split.mjs
//
// 验证目标: 把 extractAll (apps/server/src/services/combined-extractor.ts)
// 的 prompt 拆成"纯事实提取"slim version, 删除以下注入:
//   1. existingKeys - 已有实体清单
//   2. previousEntitiesBlock - N-1 全局图谱节点清单
// 通过对比 before/after 的字符数与估算 token 数, 验证假设:
//   "拆掉跨章注入后 prompt 体积显著下降 → 实际调用 AI 时 parse 失败率下降
//    → retry 不再需要"
//
// 注: existingArcs 已不再由 extractAll 喂给 AI (plot-consolidator v2 自己读
// 章节 + existing arcs 做语义级判断), 所以本验证脚本不再测这一段。
//
// 用法:
//   pnpm --filter shared build && node scripts/verify-extract-prompt-split.mjs
//   node scripts/verify-extract-prompt-split.mjs --json   # 输 JSON 报告
//
// 设计原则:
//   - 真源唯一: 直接 import packages/shared/dist/extract-prompt.js 的 buildExtractPrompt
//   - 易读: prompt 构造器在 packages/shared/src/extract-prompt.ts, 验证脚本只负责
//           "用同一份真实函数跑两次, 报告体积差异"
//   - 可扩展: 改 fixture 即可模拟不同故事压力; prompt 文字改了在 shared 包里,
//             验证脚本零修改
//   - 解耦: 验证脚本只读 dist 产物, 不读数据库 / 不调 AI

'use strict'

import { buildExtractPrompt } from '../packages/shared/dist/extract-prompt.js'

// ============================================================================
// Section 1: Fixture (模拟一个典型的归档场景)
// ============================================================================
//
// 数字选择: 主角 2 人 / 已有实体 200 个 / N-1 全局图谱 300 节点 / 章节正文 ~8000 字
//  - 接近典型玄幻长篇第 10-20 章的归档压力
//
// 想测不同压力? 改这一节就行, prompt 构造器不变.

const FIXTURE = {
  storyId: 'demo-story',
  chapterId: 'demo-chapter',
  protagonistNames: ['李凡', '赵若曦'],

  // 已有实体 type:key (current extractAll 加载, slim 模式不消费)
  existingNodeKeys: Array.from({ length: 200 }, (_, i) =>
    i < 50 ? `character:char_${i}` :
    i < 100 ? `faction:faction_${i}` :
    i < 150 ? `item:item_${i}` :
    `event:event_${i}`
  ),

  // N-1 全局图谱 (current extractAll 加载, slim 模式不消费)
  previousSnapshotNodes: Array.from({ length: 300 }, (_, i) => ({
    type: i % 4 === 0 ? 'character' : i % 4 === 1 ? 'faction' : i % 4 === 2 ? 'item' : 'event',
    key: `entity_${i}`,
    label: `实体${i}`
  })),

  // 章节内容 (约 8000 字; 模拟典型玄幻章节体量)
  content: `第一章 少年李凡, 自幼父母双亡, 被玄天宗外门长老张伯收养。
他生性沉默寡言, 但内心坚韧, 每日勤修不辍。这一日, 天降异象, 玄天宗主峰之上, 一道金光冲天而起。
李凡正在山脚采药, 抬头望去, 只见金光中隐隐有一道虚影, 形似上古仙人。
` + '李凡心中一惊, 连忙跑回住处, 把此事告诉张伯。张伯沉吟片刻, 道: "此事非同小可, 待我禀报宗门长老会。"\n'.repeat(80),

  outline: '李凡发现天降异象, 张伯决定上报宗门长老会。'
}

// ============================================================================
// Section 2: Token 估算 (CJK 1.5 chars/token, ASCII 4 chars/token)
// ============================================================================
//
// 不用 js-tiktoken (避免引入依赖); CJK 字符按 Unicode 范围粗估。
// 估算结果与真实 token 数偏差 < 10%, 用于"相对对比"足够。
// 真实精度用 apps/server 已有的 countTokens (countTokens.ts) 验证。

function estimateTokens(text) {
  if (!text) return 0
  let cjk = 0, ascii = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)
    // CJK Unified Ideographs + 扩展 A + Hiragana/Katakana + Hangul
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x3040 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) {
      cjk++
    } else {
      ascii++
    }
  }
  // 1.5 chars/token for CJK, 4 chars/token for ASCII
  return Math.ceil(cjk / 1.5 + ascii / 4)
}

// ============================================================================
// Section 3: Before / After — 直接调用 packages/shared 的 buildExtractPrompt
// ============================================================================
//
// 真源唯一: buildExtractPrompt 是 packages/shared/src/extract-prompt.ts 的
// 纯函数, 通过 mode 选项切换:
//   - mode='full': 喂入跨章上下文 (existingNodeKeys + previousSnapshotNodes)
//   - mode='slim': 不喂跨章上下文, AI 只输出本章事实

function buildBeforePrompt(f) {
  return buildExtractPrompt(
    {
      protagonistNames: f.protagonistNames,
      existingNodeKeys: f.existingNodeKeys,
      previousSnapshotNodes: f.previousSnapshotNodes,
      content: f.content,
      outline: f.outline
    },
    { mode: 'full' }
  )
}

function buildAfterPrompt(f) {
  return buildExtractPrompt(
    {
      // slim 模式不消费跨章上下文字段, 喂空数组保持接口完整
      protagonistNames: f.protagonistNames,
      existingNodeKeys: [],
      previousSnapshotNodes: [],
      content: f.content,
      outline: f.outline
    },
    { mode: 'slim' }
  )
}

// ============================================================================
// Section 4: 报告输出
// ============================================================================

function reportMarkdown(before, after, fixture) {
  const lines = []
  lines.push('# Extract Prompt Split 验证报告')
  lines.push('')
  lines.push(`生成时间: ${new Date().toISOString()}`)
  lines.push(`Fixture: 主角 ${fixture.protagonistNames.length} 人 / 已有实体 ${fixture.existingNodeKeys.length} 个 / N-1 节点 ${fixture.previousSnapshotNodes.length} 个 / 章节正文 ${fixture.content.length} 字`)
  lines.push('')
  lines.push('## 对比结果')
  lines.push('')
  lines.push('| 维度 | Before (mode=full, 喂跨章上下文) | After (mode=slim, 不喂) | 差异 |')
  lines.push('|------|-----------------------------------|-------------------------|------|')
  lines.push(`| 字符数 | ${before.chars} | ${after.chars} | ${after.chars - before.chars} (${((after.chars - before.chars) / before.chars * 100).toFixed(1)}%) |`)
  lines.push(`| 估算 token 数 | ${before.tokens} | ${after.tokens} | ${after.tokens - before.tokens} (${((after.tokens - before.tokens) / before.tokens * 100).toFixed(1)}%) |`)
  lines.push('')
  lines.push('## 删除的注入段（full 含 / slim 不含）')
  lines.push('')
  lines.push('1. **已有实体清单** (`existingNodeKeys` 拼接) - 200 个 type:key')
  lines.push('2. **N-1 全局图谱清单** (`previousEntitiesBlock`) - 300 节点')
  lines.push('3. **timelinePosition 详细 Y.DDDHH 编码说明** - slim 仅简化为 "Y.DDDHH"')
  lines.push('')
  lines.push('注: 剧情弧线 raw arcs 已不再由 extractAll 提取 — plot-consolidator v2 直接读章节 + existing arcs 做语义级判断。')
  lines.push('')
  lines.push('## 假设验证')
  lines.push('')
  const tokenReduction = (1 - after.tokens / before.tokens) * 100
  if (tokenReduction >= 30) {
    lines.push(`✅ 通过：prompt token 下降 ${tokenReduction.toFixed(1)}%，超过 30% 阈值。`)
    lines.push('   预期效果：输出更不容易超 maxTokens → parse 失败率下降 → retry 几乎不需要。')
  } else if (tokenReduction >= 15) {
    lines.push(`⚠️ 边缘：通过线以下 (${tokenReduction.toFixed(1)}%)，需要更激进的 slim 才有效。`)
  } else {
    lines.push(`❌ 未通过：仅下降 ${tokenReduction.toFixed(1)}%，不足以解决问题。需要重新设计。`)
  }
  lines.push('')
  lines.push('## 数据来源')
  lines.push('')
  lines.push('- prompt 文本真源: `packages/shared/src/extract-prompt.ts` (`buildExtractPrompt`)')
  lines.push('- 验证脚本: 直接 import `packages/shared/dist/extract-prompt.js`,零镜像,零漂移')
  return lines.join('\n')
}

function reportJson(before, after) {
  return JSON.stringify({
    before: { chars: before.chars, tokens: before.tokens },
    after: { chars: after.chars, tokens: after.tokens },
    delta: {
      chars: after.chars - before.chars,
      charsPercent: ((after.chars - before.chars) / before.chars * 100).toFixed(2),
      tokens: after.tokens - before.tokens,
      tokensPercent: ((after.tokens - before.tokens) / before.tokens * 100).toFixed(2)
    }
  }, null, 2)
}

// ============================================================================
// Section 5: Main
// ============================================================================

function main() {
  const beforePrompt = buildBeforePrompt(FIXTURE)
  const afterPrompt = buildAfterPrompt(FIXTURE)

  const before = {
    chars: beforePrompt.length,
    tokens: estimateTokens(beforePrompt)
  }
  const after = {
    chars: afterPrompt.length,
    tokens: estimateTokens(afterPrompt)
  }

  const isJson = process.argv.includes('--json')
  if (isJson) {
    console.log(reportJson(before, after))
  } else {
    console.log(reportMarkdown(before, after, FIXTURE))
  }
}

main()