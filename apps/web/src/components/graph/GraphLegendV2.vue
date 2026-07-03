<template>
  <div class="graph-legend">
    <span
      v-for="entry in entries"
      :key="entry.type"
      class="graph-legend__chip"
      :title="`${entry.label} (${entry.count}个)`"
    >
      <span class="graph-legend__swatch" :style="{ background: entry.color }" />
      <span class="graph-legend__label">{{ entry.label }}</span>
      <span class="graph-legend__count">{{ entry.count }}</span>
    </span>

    <span
      v-if="showNewMarker"
      class="graph-legend__chip is-new"
    >
      <span class="graph-legend__swatch is-new" />
      <span class="graph-legend__label">本章新增</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GRAPH_NODE_COLORS_V2, GRAPH_NODE_LABELS } from '../../api-v2/graph'

const props = defineProps<{
  showNewMarker?: boolean
  nodes: { type: string; count: number; color: string }[]
  edges: { count: number }[]
}>()

interface LegendEntry {
  type: string
  label: string
  color: string
  count: number
}

const entries = computed<LegendEntry[]>(() =>
  props.nodes.map((n) => ({
    type: n.type,
    label: GRAPH_NODE_LABELS[n.type] || n.type,
    color: GRAPH_NODE_COLORS_V2[n.type] || GRAPH_NODE_COLORS_V2.other,
    count: n.count
  }))
)
</script>

<style scoped>
.graph-legend {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
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
.graph-legend__chip.is-new {
  color: var(--color-positive);
  font-weight: var(--weight-medium);
}

.graph-legend__swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--color-pure-white), 0 0 0 3px var(--border-subtle);
}
.graph-legend__swatch.is-new {
  background: var(--color-pure-white) !important;
  border: 1.5px dashed var(--color-positive);
}

.graph-legend__count {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
