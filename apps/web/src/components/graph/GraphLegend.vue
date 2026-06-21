<template>
  <div class="graph-legend" :class="{ 'is-stacked': stacked }">
    <span
      v-for="t in entries"
      :key="t.type"
      class="graph-legend__chip"
      :title="`${t.label} — ${t.type}`"
    >
      <span
        class="graph-legend__swatch"
        :style="{ background: t.color }"
        aria-hidden="true"
      />
      <span class="graph-legend__label">{{ t.label }}</span>
    </span>

    <span
      v-if="showNewMarker"
      class="graph-legend__chip is-new"
      :title="`本章新增 ${newNodeCount} 节点 / ${newEdgeCount} 关系`"
    >
      <span
        class="graph-legend__swatch is-new"
        :style="{ borderColor: COLOR.graphNew }"
        aria-hidden="true"
      />
      <span class="graph-legend__label">本章新增</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { COLOR } from '../../styles/tokens'

/**
 * GraphLegend — 4 chip 颜色图例 (角色/势力/事件/物品) + 可选 "本章新增" 标记。
 * 共享给 GraphView (查看) 和 EditableGraph (编辑)。
 *
 * 通过 entries 传入自定义节点类型(默认 4 种, 颜色从 tokens 拉),
 * 通过 showNewMarker / newNodeCount / newEdgeCount 控制"本章新增"chip。
 */
defineProps<{
  stacked?: boolean
  showNewMarker?: boolean
  newNodeCount?: number
  newEdgeCount?: number
}>()

interface LegendEntry {
  type: string
  label: string
  color: string
}

const defaultEntries: LegendEntry[] = [
  { type: 'character', label: '角色', color: COLOR.graphCharacter },
  { type: 'faction', label: '势力', color: COLOR.graphFaction },
  { type: 'event', label: '事件', color: COLOR.graphEvent },
  { type: 'item', label: '物品', color: COLOR.graphItem }
]

const entries = computed(() => defaultEntries)
</script>

<style scoped>
.graph-legend {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.graph-legend.is-stacked {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.graph-legend__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1;
  user-select: none;
}

.graph-legend__swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  /* swatch 比 chip 略大点 4px 圆点, 跟节点风格统一 */
  box-shadow: 0 0 0 2px var(--color-pure-white), 0 0 0 3px var(--border-subtle);
}
.graph-legend__swatch.is-new {
  background: var(--color-pure-white) !important;
  box-shadow: 0 0 0 2px var(--color-pure-white), 0 0 0 3px var(--color-pure-white);
  border: 1.5px dashed;
  border-style: dashed;
}

.graph-legend__chip.is-new {
  color: var(--color-positive);
  font-weight: var(--weight-medium);
}
</style>
