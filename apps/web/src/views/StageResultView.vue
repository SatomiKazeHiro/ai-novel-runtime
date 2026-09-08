<template>
  <!-- character -->
  <div v-if="stageName === 'character'" class="sc-result">
    <ul
      v-if="(result?.characterStates?.length ?? 0) > 0"
      class="sc-list"
    >
      <li
        v-for="(row, i) in result.characterStates"
        :key="i"
        class="sc-list-item"
      >
        <div class="sc-row-main">
          <strong>{{ row.name }}</strong>
          <code class="sc-key">{{ row.key }}</code>
          <span v-if="row.isNew" class="sc-tag is-new">新增</span>
        </div>
        <div class="sc-row-meta">
          <span class="sc-meta-label">状态</span>
          <code class="sc-json">{{ truncateJson(row.status) }}</code>
        </div>
        <div class="sc-row-meta">
          <span class="sc-meta-label">关系</span>
          <code class="sc-json">{{ truncateJson(row.relationships) }}</code>
        </div>
      </li>
    </ul>
    <p v-else class="sc-text-muted">本次未抽到角色状态</p>
  </div>

  <!-- memory -->
  <div v-else-if="stageName === 'memory'" class="sc-result">
    <section v-if="(result?.mainEvents?.length ?? 0) > 0" class="sc-section">
      <h4 class="sc-section-title">主要事件 ({{ result.mainEvents.length }})</h4>
      <ul class="sc-list">
        <li v-for="(ev, i) in result.mainEvents" :key="`m${i}`" class="sc-list-item">
          <div class="sc-row-main">
            <span class="sc-imp" :data-imp="ev.importance">{{ ev.importance }}</span>
            <span>{{ ev.description }}</span>
          </div>
          <div v-if="ev.participants?.length" class="sc-row-meta">
            <span class="sc-meta-label">参与者</span>
            <span>{{ ev.participants.join('、') }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="(result?.sideEvents?.length ?? 0) > 0" class="sc-section">
      <h4 class="sc-section-title">次要事件 ({{ result.sideEvents.length }})</h4>
      <ul class="sc-list">
        <li v-for="(ev, i) in result.sideEvents" :key="`s${i}`" class="sc-list-item">
          <div class="sc-row-main">
            <span class="sc-imp" :data-imp="ev.importance">{{ ev.importance }}</span>
            <span>{{ ev.description }}</span>
          </div>
          <div v-if="ev.participants?.length" class="sc-row-meta">
            <span class="sc-meta-label">参与者</span>
            <span>{{ ev.participants.join('、') }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="(result?.scenes?.length ?? 0) > 0" class="sc-section">
      <h4 class="sc-section-title">场景 ({{ result.scenes.length }})</h4>
      <ul class="sc-list">
        <li v-for="(sc, i) in result.scenes" :key="`sc${i}`" class="sc-list-item">
          <div class="sc-row-main">
            <span class="sc-imp" :data-imp="sc.importance">{{ sc.importance }}</span>
            <strong>{{ sc.location }}</strong>
          </div>
          <div class="sc-row-meta">
            <span>{{ sc.event }}</span>
          </div>
        </li>
      </ul>
    </section>

    <p v-if="result?.summary" class="sc-summary">摘要：{{ result.summary }}</p>

    <p
      v-if="
        (result?.mainEvents?.length ?? 0) === 0 &&
        (result?.sideEvents?.length ?? 0) === 0 &&
        (result?.scenes?.length ?? 0) === 0 &&
        !result?.summary
      "
      class="sc-text-muted"
    >本次未抽到记忆</p>
  </div>

  <!-- plotArc -->
  <div v-else-if="stageName === 'plotArc'" class="sc-result">
    <ul
      v-if="(result?.plotArcs?.length ?? 0) > 0"
      class="sc-list"
    >
      <li
        v-for="(arc, i) in result.plotArcs"
        :key="i"
        class="sc-list-item"
      >
        <div class="sc-row-main">
          <strong>{{ arc.name }}</strong>
          <span v-if="arc.isNew" class="sc-tag is-new">新增</span>
          <span class="sc-tag" :data-status="arc.status">{{ arc.status }}</span>
        </div>
        <div class="sc-row-meta">
          <span class="sc-meta-label">类型</span>
          <span>{{ arc.type === 'main' ? '主线' : arc.type === 'side' ? '支线' : (arc.type || '?') }}</span>
          <span class="sc-meta-label">进度</span>
          <span>{{ arc.progress }}%</span>
          <span class="sc-meta-label">当前阶段</span>
          <span>{{ arc.currentStage || '未知' }}</span>
        </div>
      </li>
    </ul>
    <p v-else class="sc-text-muted">本次未抽到剧情弧线</p>
  </div>

  <!-- graph -->
  <div v-else-if="stageName === 'graph'" class="sc-result">
    <template v-if="result?.chapterGraph">
      <div class="sc-row-meta">
        <span class="sc-meta-label">节点</span>
        <span>{{ result.chapterGraph.nodes?.length ?? 0 }}</span>
        <span class="sc-meta-label">边</span>
        <span>{{ result.chapterGraph.edges?.length ?? 0 }}</span>
      </div>

      <section v-if="(result.chapterGraph.nodes?.length ?? 0) > 0" class="sc-section">
        <h4 class="sc-section-title">节点（最多展示 10 个）</h4>
        <ul class="sc-list sc-list-compact">
          <li
            v-for="(n, i) in (result.chapterGraph.nodes || []).slice(0, 10)"
            :key="`n${i}`"
            class="sc-list-item"
          >
            <code class="sc-node">{{ n.type }}:{{ n.key }}<span v-if="n.label"> ({{ n.label }})</span></code>
          </li>
        </ul>
      </section>

      <section v-if="(result.chapterGraph.edges?.length ?? 0) > 0" class="sc-section">
        <h4 class="sc-section-title">关系</h4>
        <ul class="sc-list sc-list-compact">
          <li
            v-for="(e, i) in (result.chapterGraph.edges || [])"
            :key="`e${i}`"
            class="sc-list-item"
          >
            <code class="sc-edge">
              {{ e.fromType }}:{{ e.fromKey }} → {{ e.toType }}:{{ e.toKey }}
              <span v-if="e.relation"> ({{ e.relation }})</span>
            </code>
          </li>
        </ul>
      </section>

      <p
        v-if="
          (result.chapterGraph.nodes?.length ?? 0) === 0 &&
          (result.chapterGraph.edges?.length ?? 0) === 0
        "
        class="sc-text-muted"
      >本次未抽到本章图谱</p>
    </template>
    <p v-else class="sc-text-muted">本次未抽到本章图谱</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 只读展示 StageCard 的 result 字段。按 stageName 分支渲染
 * character / memory / plotArc / graph 的具体数据。
 *
 * 为什么要单独抽出：StageCard 的 scoped slot 把 result 类型推导成
 * `unknown`，父组件模板上访问属性会被 vue-tsc 拒绝。把 result 接进
 * `defineProps<{ result: any }>()` 后，子组件内部访问就是合法 `any`。
 *
 * 这是 ReviewingPanel 的内部展示组件，不属于 StageCard 接口。
 */
defineProps<{
  stageName: 'character' | 'memory' | 'plotArc' | 'graph'
  result: any
}>()

/**
 * 把后端 JSON 字符串字段（status / relationships）安全截断展示。
 * - 已经是对象 → 直接走 JSON.stringify
 * - 是字符串 → 尝试 parse；parse 失败时退回原串
 * - null/undefined → 返回空串
 * - 截断到 240 字符，避免卡片被超长 JSON 撑爆
 */
function truncateJson(value: unknown, max = 240): string {
  if (value === null || value === undefined) return ''
  let text: string
  if (typeof value === 'string') {
    try {
      text = JSON.stringify(JSON.parse(value))
    } catch {
      text = value
    }
  } else {
    text = JSON.stringify(value)
  }
  if (text.length > max) text = text.slice(0, max) + '…'
  return text
}
</script>

<style scoped>
.sc-result {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sc-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sc-section-title {
  margin: 0;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.sc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sc-list-compact {
  gap: 4px;
}

.sc-list-item {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-input, 6px);
  background: var(--color-canvas);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.sc-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.sc-row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
  flex-wrap: wrap;
}

.sc-meta-label {
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
}

.sc-key,
.sc-json,
.sc-node,
.sc-edge {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-stone-gray);
  padding: 1px 6px;
  border-radius: 4px;
}

.sc-json {
  word-break: break-all;
}

.sc-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
  color: var(--text-secondary);
}

.sc-tag.is-new {
  background: color-mix(in srgb, var(--color-positive, #0a0) 18%, transparent);
  color: var(--color-positive, #0a0);
}

.sc-tag[data-status="active"] {
  background: color-mix(in srgb, var(--color-positive, #0a0) 15%, transparent);
  color: var(--color-positive, #0a0);
}
.sc-tag[data-status="resolving"],
.sc-tag[data-status="closed"] {
  background: color-mix(in srgb, #c80 18%, transparent);
  color: #c80;
}
.sc-tag[data-status="stale"] {
  background: color-mix(in srgb, var(--color-link, #37f) 15%, transparent);
  color: var(--color-link, #37f);
}

.sc-imp {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  padding: 1px 6px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
}
.sc-imp[data-imp="8"],
.sc-imp[data-imp="9"],
.sc-imp[data-imp="10"] {
  background: color-mix(in srgb, var(--color-positive, #0a0) 18%, transparent);
  color: var(--color-positive, #0a0);
}
.sc-imp[data-imp="6"],
.sc-imp[data-imp="7"] {
  background: color-mix(in srgb, #c80 18%, transparent);
  color: #c80;
}

.sc-summary {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  border-left: 3px solid var(--color-link, #37f);
  padding-left: var(--space-3);
}

.sc-text-muted {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>