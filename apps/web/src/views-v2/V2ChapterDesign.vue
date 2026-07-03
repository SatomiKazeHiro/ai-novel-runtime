<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHAPTER DESIGN</span>
        <h1 class="page-head__title">
          <n-button size="small" style="margin-right: 8px" @click="goBack">←</n-button>
          {{ chapter?.title || '章节设计' }}
          <n-tag v-if="chapter" :type="statusTagType(chapter.status)" :bordered="false" size="small" style="margin-left: 12px; vertical-align: middle">
            {{ statusLabel(chapter.status) }}
          </n-tag>
        </h1>
      </div>
    </header>

    <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary)">加载中...</div>

    <template v-else-if="chapter">
      <!-- 顶部通知条 -->
      <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

      <div class="design-flow">

        <!-- ====== Step 1: 大纲 ====== -->
        <div class="cap-card">
          <h2 class="cap-eyebrow" style="margin: 0; margin-bottom: 8px">1. 大纲</h2>
          <n-input
            v-model:value="outline"
            type="textarea"
            :rows="15"
            placeholder="本章大纲，将作为输入拼入生成 prompt..."
            :disabled="chapter.status !== 'draft'"
            style="font-size: 13px; line-height: 1.6"
          />
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px">
            <span style="font-size: 11px; color: var(--text-tertiary)">字数：{{ outline.length }}</span>
            <n-button
              v-if="chapter.status === 'draft'"
              size="tiny"
              @click="saveOutline"
              :loading="savingOutline"
            >保存大纲</n-button>
          </div>
          <p v-if="chapter.status === 'draft' && !outline.trim()" style="font-size: 11px; color: var(--color-negative); margin: 4px 0 0">
            请先填写并保存大纲
          </p>
        </div>

        <!-- ====== Step 2: 数据源（大纲保存后出现） ====== -->
        <div v-if="step >= 2" class="cap-card">
          <h2 class="cap-eyebrow" style="margin-top: 0; margin-bottom: 10px">2. 数据源</h2>
          <n-tabs type="segment" animated>
            <n-tab-pane name="characters">
              <template #tab>
                角色 <span style="color: var(--text-tertiary); font-size: 11px">({{ configCharacterIds.length }})</span>
              </template>
              <div class="tab-content">
                <div style="margin-bottom: 8px">
                  <n-button
                    size="tiny"
                    :disabled="chapter.status !== 'draft' || !outline.trim()"
                    @click="onCharacterAutoSelect"
                  >系统分配</n-button>
                  <span v-if="!outline.trim()" style="font-size: 10px; color: var(--text-tertiary); margin-left: 6px">需先保存大纲</span>
                </div>
                <n-checkbox-group v-model:value="configCharacterIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="c in availableCharacters" :key="c.id" :value="c.id">
                      {{ c.name }}
                      <span v-if="c.isProtagonist" style="color: var(--accent); font-size: 11px">[主角]</span>
                      <span style="color: var(--text-tertiary); font-size: 11px; margin-left: 4px">{{ c.slug }}</span>
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availableCharacters.length === 0" description="暂无角色" style="padding: 12px" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="memories">
              <template #tab>
                记忆 <span style="color: var(--text-tertiary); font-size: 11px">({{ configMemoryIds.length }})</span>
              </template>
              <div class="tab-content">
                <div style="margin-bottom: 8px">
                  <n-button
                    size="tiny"
                    :disabled="chapter.status !== 'draft' || !outline.trim()"
                    :loading="searchingMemories"
                    @click="onMemorySearch"
                  >系统分配</n-button>
                  <span v-if="!outline.trim()" style="font-size: 10px; color: var(--text-tertiary); margin-left: 6px">需先保存大纲</span>
                </div>
                <n-checkbox-group v-model:value="configMemoryIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="m in availableMemories" :key="m.id" :value="m.id">
                      <span :style="{ color: m.type === 'temporary' ? 'var(--accent)' : 'inherit' }">
                        [{{ m.type === 'global' ? '全局' : m.type === 'chapter' ? '章节' : m.type === 'scene' ? '场景' : '临时' }}]
                      </span>
                      <span style="font-size: 10px; color: var(--text-tertiary); margin: 0 2px">(重要度·{{ m.importance }})</span>
                      {{ m.content?.substring(0, 35) || m.id.substring(0, 8) }}
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availableMemories.length === 0" description="暂无记忆" style="padding: 12px" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="plotArcs">
              <template #tab>
                剧情弧线 <span style="color: var(--text-tertiary); font-size: 11px">({{ configPlotArcIds.length }})</span>
              </template>
              <div class="tab-content">
                <n-checkbox-group v-model:value="configPlotArcIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="a in availablePlotArcs" :key="a.id" :value="a.id">
                      {{ a.title }}
                      <span style="font-size: 11px; margin-left: 4px" :style="{ color: a.status === 'active' ? 'var(--accent)' : 'var(--text-tertiary)' }">
                        [{{ a.status === 'active' ? '活跃' : a.status === 'interrupted' ? '中断' : a.status === 'completed' ? '完成' : '关闭' }}]
                      </span>
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availablePlotArcs.length === 0" description="暂无剧情弧线" style="padding: 12px" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="lore">
              <template #tab>
                世界观 <span style="color: var(--text-tertiary); font-size: 11px">({{ configLoreIds.length }})</span>
              </template>
              <div class="tab-content">
                <n-checkbox-group v-model:value="configLoreIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="l in availableLore" :key="l.id" :value="l.id">
                      <span style="font-size: 11px; color: var(--text-tertiary); font-family: monospace">{{ l.category }}/</span>
                      {{ l.name }}
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availableLore.length === 0" description="暂无世界观条目" style="padding: 12px" />
              </div>
            </n-tab-pane>
          </n-tabs>

          <div style="display: flex; justify-content: flex-end; margin-top: 16px">
            <n-button
              v-if="chapter.status === 'draft'"
              type="primary"
              @click="handleGeneratePrompt"
              :loading="generatingPrompt"
              :disabled="generatingPrompt || !outline.trim()"
            >生成 Prompt</n-button>
          </div>
        </div>

        <!-- ====== AI 模型（左 1/3） + Prompt 预览（右 2/3）（生成Prompt后出现） ====== -->
        <div v-if="step >= 2" class="split-row" style="grid-template-columns: 1fr 2fr">
          <!-- 左：AI 模型 -->
          <div class="cap-card">
            <h2 class="cap-eyebrow" style="margin-top: 0; margin-bottom: 10px">3. AI 模型</h2>
            <div class="config-field">
              <label class="config-field__label">模型</label>
              <n-select
                v-model:value="configProviderId"
                :options="modelOptions"
                placeholder="默认模型"
                clearable
                size="small"
                :disabled="chapter.status !== 'draft'"
              />
              <p v-if="selectedModel" style="font-size: 11px; color: var(--text-tertiary); margin: 2px 0 0">
                上下文: {{ (selectedModel.contextLength / 1000).toFixed(0) }}K
              </p>
            </div>
            <div class="config-field">
              <label class="config-field__label">Temperature</label>
              <div style="display: flex; align-items: center; gap: 8px">
                <n-slider
                  v-model:value="configTemperature"
                  :min="0" :max="2" :step="0.1"
                  style="flex:1"
                  :disabled="chapter.status !== 'draft'"
                />
                <span style="font-family: monospace; font-size: 12px; width: 28px; text-align: right">{{ configTemperature.toFixed(1) }}</span>
              </div>
            </div>
            <div class="config-field">
              <label class="config-field__label">Max Tokens</label>
              <n-input-number
                v-model:value="configMaxTokens"
                :min="256" :max="64000" :step="256"
                size="small"
                style="width: 100%"
                :disabled="chapter.status !== 'draft'"
              />
            </div>
          </div>

          <!-- 右：Prompt 预览 -->
          <div class="cap-card">
            <h2 class="cap-eyebrow" style="margin-top: 0; margin-bottom: 8px">3. Prompt 预览</h2>
            <template v-if="assembledPrompt">
              <n-tabs type="segment" animated>
                <n-tab-pane name="system" tab="System Message">
                  <pre class="prompt-preview">{{ assembledPrompt.systemMessage }}</pre>
                </n-tab-pane>
                <n-tab-pane name="user" tab="User Message">
                  <pre class="prompt-preview">{{ assembledPrompt.userMessage }}</pre>
                </n-tab-pane>
              </n-tabs>
              <div v-if="assembledPrompt.estimatedTotalTokens" style="margin-top: 8px; font-size: 11px; color: var(--text-tertiary)">
                System ~{{ (assembledPrompt.estimatedSystemTokens! / 1000).toFixed(1) }}K
                · User ~{{ (assembledPrompt.estimatedUserTokens! / 1000).toFixed(1) }}K
                · 合计 ~{{ (assembledPrompt.estimatedTotalTokens / 1000).toFixed(1) }}K
                <template v-if="assembledPrompt.contextBudget"> / 预算 {{ (assembledPrompt.contextBudget / 1000).toFixed(0) }}K</template>
              </div>
            </template>
            <p v-else style="color: var(--text-tertiary); font-size: 12px; padding: 20px 0; text-align: center">点击"生成 Prompt"后在此预览</p>
          </div>
        </div>

        <!-- ====== 候选文章 | 正文（生成Prompt后出现） ====== -->
        <template v-if="step >= 3">

          <!-- 候选（左）| 正文（右） -->
          <div class="split-row">
            <div class="split-left">
              <div class="cap-card" style="height: 100%">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
                  <h2 class="cap-eyebrow" style="margin: 0">
                    候选文章
                    <span v-if="generatingCount > 0" style="color: var(--color-warning); font-size: 12px; font-weight: normal; margin-left: 8px">生成中...</span>
                  </h2>
                  <n-button
                    v-if="chapter.status === 'draft'"
                    size="tiny"
                    type="primary"
                    @click="handleGenerate"
                    :disabled="generatingCount >= 3 || !outline.trim()"
                  >
                    生成候选 ({{ generatingCount }}/3)
                  </n-button>
                </div>

                <p v-if="drafts.length === 0" class="cap-body-sm" style="color: var(--text-tertiary)">
                  点击"生成候选"，AI 生成的候选文章将出现在这里。
                </p>

                <n-tabs v-else v-model:value="activeDraftTab" type="card" animated size="small">
                  <n-tab-pane v-for="draft in drafts" :key="draft.id" :name="draft.id">
                    <template #tab>
                      <span style="display: flex; align-items: center; gap: 4px; font-size: 12px">
                        候选 {{ draft.id.substring(0, 8) }}
                        <n-tag v-if="draft.status === 'generating'" type="warning" size="tiny" :bordered="false">生成中</n-tag>
                        <n-tag v-else-if="draft.status === 'completed'" type="success" size="tiny" :bordered="false">已完成</n-tag>
                        <n-tag v-else-if="draft.status === 'failed'" type="error" size="tiny" :bordered="false">失败</n-tag>
                      </span>
                    </template>
                    <div class="draft-body">
                      <pre v-if="draft.content" class="draft-content">{{ draft.content }}</pre>
                      <p v-else-if="draft.status === 'generating'" style="color: var(--text-tertiary); font-style: italic; text-align: center; padding: 40px 0">等待 AI 响应...</p>
                      <p v-else-if="draft.status === 'failed'" style="color: var(--color-negative); text-align: center; padding: 20px 0">生成失败</p>
                    </div>
                    <div class="draft-footer">
                      <span class="draft-word-count">{{ draftWordCount(draft) }}</span>
                      <span class="draft-footer-actions">
                        <n-button v-if="draft.status === 'completed'" size="tiny" @click="adoptDraft(draft)">采用</n-button>
                        <n-button size="tiny" @click="openDraftConfig(draft)">配置</n-button>
                        <n-popconfirm @positive-click="draft.status === 'generating' ? cancelGeneration(draft.id) : deleteDraft(draft.id)">
                          <template #trigger><n-button size="tiny" type="error">删除</n-button></template>
                          {{ draft.status === 'generating' ? '确定终止生成并删除吗？' : '确定删除该候选吗？' }}
                        </n-popconfirm>
                      </span>
                    </div>
                  </n-tab-pane>
                </n-tabs>
              </div>
            </div>

            <!-- 正文 -->
            <div class="split-right">
              <div class="cap-card" style="height: 100%">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px">
                  <h2 class="cap-eyebrow" style="margin: 0">正文</h2>
                  <span v-if="chapter.contentHash" style="font-size: 10px; color: var(--text-tertiary); font-family: monospace">
                    SHA256: {{ chapter.contentHash.substring(0, 16) }}...
                  </span>
                </div>
                <n-input
                  v-model:value="content"
                  type="textarea"
                  :rows="14"
                  placeholder="直接输入正文，或从左侧候选文章中采用..."
                  :disabled="chapter.status === 'archived'"
                  style="font-family: var(--font-serif); font-size: 14px; line-height: 1.8"
                />
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px">
                  <span style="font-size: 11px; color: var(--text-tertiary)">字数：{{ content.length.toLocaleString() }}</span>
                  <n-button
                    v-if="chapter.status !== 'archived'"
                    type="primary"
                    size="tiny"
                    @click="saveContent"
                    :loading="saving"
                  >保存正文</n-button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ====== Step 4: AI 分析（正文保存后出现） ====== -->
        <div v-if="step >= 4" class="cap-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
            <h2 class="cap-eyebrow" style="margin: 0">4. AI 分析</h2>
            <n-space>
              <n-button
                v-if="chapter.status === 'analyzing'"
                size="small"
                type="warning"
                @click="revertAnalysis"
                :loading="reverting"
              >撤销分析</n-button>
              <n-button
                v-if="chapter.status === 'draft'"
                size="small"
                type="primary"
                @click="runAnalyze"
                :loading="analyzeRunning"
                :disabled="analyzeRunning || !chapter.content"
              >分析</n-button>
              <n-button
                v-if="chapter.status === 'analyzing'"
                size="small"
                type="primary"
                @click="runAnalyze"
                :loading="analyzeRunning"
                :disabled="analyzeRunning"
              >重新分析</n-button>
            </n-space>
          </div>

          <p v-if="chapter.status === 'draft' && !analyzeRunning" class="cap-body-sm" style="color: var(--text-tertiary); margin-bottom: 12px">
            点击"分析"将并行调用 AI 提取角色、记忆、剧情弧线、时间线、图谱信息。
          </p>

          <div v-if="chapter.analysisId" class="analysis-status" style="margin-bottom: 12px; font-size: 12px; color: var(--text-tertiary)">
            分析版本：
            <span :style="{ color: chapter.analysisId === chapter.contentHash ? 'var(--color-positive)' : 'var(--color-negative)' }">
              {{ chapter.analysisId.substring(0, 8) + '...' }}
            </span>
            <span v-if="chapter.analysisId !== chapter.contentHash" style="color: var(--color-negative); margin-left: 8px">正文已修改，分析可能过时</span>
          </div>

          <n-tabs v-if="analysis" v-model:value="analysisActiveTab" type="segment" animated>
            <n-tab-pane v-for="item in analyzerItems" :key="item.key" :name="item.key">
              <template #tab>
                <span style="display: flex; align-items: center; gap: 4px; font-size: 12px">
                  {{ item.label }}
                  <span v-if="item.status === 'loading'" class="analyzer-item__tag is-loading">分析中...</span>
                  <span v-else-if="item.status === 'success'" class="analyzer-item__tag is-success">已完成</span>
                  <span v-else-if="item.status === 'failed'" class="analyzer-item__tag is-failed">失败</span>
                </span>
              </template>
              <div class="analyzer-tab-content">
                <template v-if="item.status === 'failed'">
                  <div class="analyzer-item__error">{{ item.error }}</div>
                </template>
                <template v-else-if="item.status === 'success' && editableAnalysis">
                  <!-- 角色 -->
                  <template v-if="item.key === 'characters'">
                    <div v-if="!getAnalyzerData('characters')?.items?.length" class="analyzer-idle">未提取到角色</div>
                    <div v-else class="char-list">
                      <div v-for="(c, ci) in getAnalyzerData('characters').items" :key="ci" class="char-row">
                        <div class="char-row__head">
                          <strong>{{ c.name }}</strong>
                          <span class="char-row__slug">{{ c.slug }}</span>
                          <n-tag v-if="c.isNew" type="warning" size="tiny" :bordered="false">新角色</n-tag>
                          <n-tag v-else type="info" size="tiny" :bordered="false">匹配: {{ c.matchedCharacterId?.substring(0, 8) }}</n-tag>
                          <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('characters').items.splice(ci, 1)">×</n-button>
                        </div>
                        <div class="char-row__field"><span class="tag-label">身份</span><n-dynamic-tags v-model:value="c.identity" /></div>
                        <div class="char-row__field"><span class="tag-label">外貌</span><n-dynamic-tags v-model:value="c.appearance" /></div>
                        <div class="char-row__field"><span class="tag-label">气质</span><n-dynamic-tags v-model:value="c.temperament" /></div>
                        <div class="char-row__field"><span class="tag-label">性格</span><n-dynamic-tags v-model:value="c.personality" /></div>
                        <div class="char-row__field"><span class="tag-label">说话</span><n-dynamic-tags v-model:value="c.speechStyle" /></div>
                        <div class="char-row__field">
                          <span class="tag-label">关系变化</span>
                          <n-input v-model:value="c.relationshipsText" type="textarea" :rows="2" size="small" placeholder='{"张三": "因某事变为敌人"}' style="font-family: monospace; font-size: 12px" />
                        </div>
                        <div class="char-row__field">
                          <span class="tag-label">状态变化</span>
                          <n-input v-model:value="c.statusText" type="textarea" :rows="2" size="small" placeholder='{"修为": "突破到金丹期"}' style="font-family: monospace; font-size: 12px" />
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- 记忆 -->
                  <template v-else-if="item.key === 'memories'">
                    <div class="mem-section">
                      <h4 class="mem-section__title">章节记忆 <span class="mem-count">{{ getAnalyzerData('memories')?.chapterMemories?.length || 0 }}</span></h4>
                      <div v-if="!getAnalyzerData('memories')?.chapterMemories?.length" class="analyzer-idle">无</div>
                      <div v-for="(m, mi) in getAnalyzerData('memories').chapterMemories" :key="'c'+mi" class="mem-row">
                        <div class="mem-row__head">
                          <n-select v-model:value="m.category" :options="memCatOptions" size="tiny" style="width: 100px" />
                          <n-input-number v-model:value="m.importance" :min="0" :max="10" size="tiny" style="width: 80px" />
                          <span class="mem-row__imp-label">重要度</span>
                          <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('memories').chapterMemories.splice(mi, 1)">×</n-button>
                        </div>
                        <n-input v-model:value="m.content" type="textarea" :rows="2" size="small" style="font-size: 13px; line-height: 1.6" />
                        <n-input v-model:value="m.participants" size="small" placeholder="参与者（逗号分隔）" style="margin-top: 4px" />
                      </div>
                      <n-button size="tiny" dashed @click="getAnalyzerData('memories').chapterMemories.push({ type:'chapter', category:'event_memory', content:'', importance:4, participants:'' })">+ 添加章节记忆</n-button>
                    </div>
                    <div class="mem-section">
                      <h4 class="mem-section__title">全局记忆 <span class="mem-count">{{ getAnalyzerData('memories')?.globalMemories?.length || 0 }}</span></h4>
                      <div v-if="!getAnalyzerData('memories')?.globalMemories?.length" class="analyzer-idle">无</div>
                      <div v-for="(m, mi) in getAnalyzerData('memories').globalMemories" :key="'g'+mi" class="mem-row">
                        <div class="mem-row__head">
                          <n-select v-model:value="m.category" :options="memCatOptions" size="tiny" style="width: 100px" />
                          <n-input-number v-model:value="m.importance" :min="0" :max="10" size="tiny" style="width: 80px" />
                          <span class="mem-row__imp-label">重要度</span>
                          <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('memories').globalMemories.splice(mi, 1)">×</n-button>
                        </div>
                        <n-input v-model:value="m.content" type="textarea" :rows="2" size="small" style="font-size: 13px; line-height: 1.6" />
                        <n-input v-model:value="m.participants" size="small" placeholder="参与者（逗号分隔）" style="margin-top: 4px" />
                      </div>
                      <n-button size="tiny" dashed @click="getAnalyzerData('memories').globalMemories.push({ type:'global', category:'event_memory', content:'', importance:4, participants:'' })">+ 添加全局记忆</n-button>
                    </div>
                    <div class="mem-section">
                      <h4 class="mem-section__title">场景记忆 <span class="mem-count">{{ getAnalyzerData('memories')?.sceneMemories?.length || 0 }}</span></h4>
                      <div v-if="!getAnalyzerData('memories')?.sceneMemories?.length" class="analyzer-idle">无</div>
                      <div v-for="(m, mi) in getAnalyzerData('memories').sceneMemories" :key="'s'+mi" class="mem-row">
                        <div class="mem-row__head">
                          <n-input-number v-model:value="m.importance" :min="0" :max="10" size="tiny" style="width: 80px" />
                          <span class="mem-row__imp-label">重要度</span>
                          <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('memories').sceneMemories.splice(mi, 1)">×</n-button>
                        </div>
                        <n-input v-model:value="m.content" type="textarea" :rows="2" size="small" style="font-size: 13px; line-height: 1.6" />
                        <n-input v-model:value="m.participants" size="small" placeholder="参与者（逗号分隔）" style="margin-top: 4px" />
                      </div>
                      <n-button size="tiny" dashed @click="getAnalyzerData('memories').sceneMemories.push({ type:'scene', category:'event_memory', content:'', importance:4, participants:'' })">+ 添加场景记忆</n-button>
                    </div>
                  </template>

                  <!-- 剧情弧线 -->
                  <template v-else-if="item.key === 'plotArcs'">
                    <div v-if="!getAnalyzerData('plotArcs')?.arcs?.length" class="analyzer-idle">未提取到剧情弧线变化</div>
                    <div v-for="(a, ai) in getAnalyzerData('plotArcs').arcs" :key="ai" class="arc-row">
                      <div class="arc-row__head">
                        <n-select v-model:value="a.action" :options="arcActionOptions" size="tiny" style="width: 80px" />
                        <n-input v-model:value="a.title" size="small" style="flex:1; font-weight: 500" />
                        <n-checkbox v-model:checked="a.isMainline" size="small">主线</n-checkbox>
                        <n-select v-model:value="a.status" :options="arcStatusOptions" size="tiny" style="width: 90px" />
                        <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('plotArcs').arcs.splice(ai, 1)">×</n-button>
                      </div>
                      <n-input v-model:value="a.description" type="textarea" :rows="2" size="small" placeholder="描述..." style="font-size: 13px; margin-top: 4px" />
                      <n-input v-if="a.action === 'close'" v-model:value="a.mergeInfo" size="small" placeholder="合并到哪条弧线..." style="margin-top: 4px" />
                    </div>
                    <n-button size="tiny" dashed @click="getAnalyzerData('plotArcs').arcs.push({ action:'create', title:'', description:'', status:'active', isMainline:false })">+ 添加弧线</n-button>
                  </template>

                  <!-- 时间线 -->
                  <template v-else-if="item.key === 'timeline'">
                    <div v-if="!getAnalyzerData('timeline')?.events?.length" class="analyzer-idle">未提取到时间线事件</div>
                    <div v-else class="time-list">
                      <div class="time-summary" style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px">
                        时间轴：{{ getAnalyzerData('timeline').defaultAnchorName || '主线' }} · {{ getAnalyzerData('timeline').events.length }} 个事件
                      </div>
                      <div v-for="(ev, ei) in getAnalyzerData('timeline').events" :key="ei" class="time-row">
                        <div class="time-row__order">{{ String(ev.narrativeOrder || ei + 1).padStart(2, '0') }}</div>
                        <div class="time-row__body">
                          <div class="time-row__head">
                            <n-input v-model:value="ev.title" size="small" style="font-weight: 500" />
                            <n-tag :type="ev.importance === 'major' ? 'error' : ev.importance === 'minor' ? 'default' : 'info'" size="tiny" :bordered="false">{{ ev.importance === 'major' ? '重要' : ev.importance === 'minor' ? '次要' : '常规' }}</n-tag>
                            <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('timeline').events.splice(ei, 1)">×</n-button>
                          </div>
                          <n-input v-model:value="ev.summary" type="textarea" :rows="2" size="small" style="font-size: 13px; margin-top: 4px" placeholder="事件摘要..." />
                          <div class="time-row__meta">
                            <n-input v-model:value="ev.participants" size="tiny" placeholder="参与者（逗号分隔）" style="flex: 1" />
                            <n-input v-model:value="ev.location" size="tiny" placeholder="地点" style="flex: 1" />
                          </div>
                          <div v-if="ev.timeExpression" class="time-row__time">
                            <span class="tag-label">时间</span><n-tag size="tiny" :bordered="false">{{ ev.timeExpression.type }}</n-tag>
                            <span v-if="ev.timeExpression.raw" style="font-size: 12px; color: var(--text-secondary)">{{ ev.timeExpression.raw }}</span>
                            <span class="tag-label" style="margin-left: 8px">置信度</span>
                            <n-tag :type="ev.timeExpression.confidence === 'high' ? 'success' : ev.timeExpression.confidence === 'low' ? 'warning' : 'default'" size="tiny" :bordered="false">{{ ev.timeExpression.confidence }}</n-tag>
                          </div>
                        </div>
                      </div>
                      <n-button size="tiny" dashed @click="getAnalyzerData('timeline').events.push({ title:'', summary:'', participants:'', location:'', importance:'normal', timeExpression:{ raw:'', type:'none', confidence:'medium' }, narrativeOrder: getAnalyzerData('timeline').events.length + 1 })">+ 添加事件</n-button>
                    </div>
                  </template>

                  <!-- 图谱 -->
                  <template v-else>
                    <div v-if="!getAnalyzerData('graph')?.chapterGraph?.nodes?.length && !getAnalyzerData('graph')?.mergedGraph?.nodes?.length" class="analyzer-idle">未提取到图谱数据</div>
                    <template v-else>
                      <!-- 本章图谱迷你画布 -->
                      <div class="graph-mini-header">
                        <span>本章图谱</span>
                        <span class="mem-count">{{ (getAnalyzerData('graph')?.chapterGraph?.nodes || []).length }} 节点 / {{ (getAnalyzerData('graph')?.chapterGraph?.edges || []).length }} 边</span>
                      </div>
                      <div ref="analysisCyContainer" class="graph-mini-canvas" />
                      <!-- 图例 -->
                      <div class="graph-mini-types">
                        <span v-for="(cnt, type) in chapterTypeStats" :key="type" class="graph-type-chip">
                          <span class="graph-type-dot" :style="{ background: GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other }"></span>
                          {{ GRAPH_NODE_LABELS[type] || type }}: {{ cnt }}
                        </span>
                      </div>
                      <!-- 可折叠编辑区 -->
                      <div style="margin-top: 8px">
                        <n-button size="tiny" quaternary @click="showGraphEditor = !showGraphEditor">{{ showGraphEditor ? '收起编辑' : '展开编辑' }}</n-button>
                      </div>
                      <template v-if="showGraphEditor">
                        <div class="graph-section">
                          <div class="graph-sub-title">节点</div>
                          <div v-for="(n, ni) in getAnalyzerData('graph').chapterGraph.nodes" :key="'gn'+ni" class="graph-node-row">
                            <n-select v-model:value="n.type" :options="graphTypeOptions" size="tiny" style="width: 80px" />
                            <n-input v-model:value="n.key" size="tiny" style="width: 100px" placeholder="key" />
                            <n-input v-model:value="n.label" size="tiny" style="width: 100px" placeholder="名称" />
                            <n-input-number v-model:value="n.importance" :min="1" :max="10" size="tiny" style="width: 65px" />
                            <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('graph').chapterGraph.nodes.splice(ni, 1); refreshAnalysisGraph()">×</n-button>
                          </div>
                          <div class="graph-sub-title" style="margin-top: 6px">边</div>
                          <div v-for="(e, ei) in getAnalyzerData('graph').chapterGraph.edges" :key="'ge'+ei" class="graph-edge-row">
                            <n-input v-model:value="e.fromKey" size="tiny" style="width: 100px" placeholder="fromKey" />
                            <span class="graph-edge-arrow">→</span>
                            <n-input v-model:value="e.relation" size="tiny" style="width: 70px" placeholder="关系" />
                            <span class="graph-edge-arrow">→</span>
                            <n-input v-model:value="e.toKey" size="tiny" style="width: 100px" placeholder="toKey" />
                            <n-button size="tiny" quaternary type="error" @click="getAnalyzerData('graph').chapterGraph.edges.splice(ei, 1); refreshAnalysisGraph()">×</n-button>
                          </div>
                          <div style="margin-top: 6px; display: flex; gap: 6px">
                            <n-button size="tiny" dashed @click="getAnalyzerData('graph').chapterGraph.nodes.push({ type:'character', key:'', label:'', importance:5 }); refreshAnalysisGraph()">+ 节点</n-button>
                            <n-button size="tiny" dashed @click="getAnalyzerData('graph').chapterGraph.edges.push({ fromKey:'', toKey:'', relation:'关联' }); refreshAnalysisGraph()">+ 边</n-button>
                          </div>
                        </div>
                      </template>
                      <!-- 总图谱摘要 -->
                      <div class="graph-section" style="margin-top: 10px">
                        <h4 class="mem-section__title">总图谱 <span class="mem-count">{{ (getAnalyzerData('graph')?.mergedGraph?.nodes || []).length }} 节点 / {{ (getAnalyzerData('graph')?.mergedGraph?.edges || []).length }} 边</span></h4>
                        <div class="graph-merged-types">
                          <span v-for="(cnt, type) in mergedTypeStats" :key="type" class="graph-type-chip">
                            <span class="graph-type-dot" :style="{ background: GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other }"></span>
                            {{ GRAPH_NODE_LABELS[type] || type }}: {{ cnt }}
                          </span>
                        </div>
                      </div>
                    </template>
                  </template>

                  <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center" v-if="chapter.status !== 'archived'">
                    <n-button size="tiny" @click="saveEdits" :loading="savingEdits">保存调整</n-button>
                    <n-button size="tiny" quaternary @click="regenerateSingle(item.key)" :loading="regenerating === item.key" :disabled="analyzeRunning">重新生成</n-button>
                  </div>
                </template>
              </div>
            </n-tab-pane>
          </n-tabs>
        </div>

        <!-- ====== Step 5: 归档（分析保存后出现） ====== -->
        <div v-if="step >= 5" class="cap-card">
          <h2 class="cap-eyebrow" style="margin-top: 0">5. 归档</h2>
          <p class="cap-body-sm" style="color: var(--text-tertiary); margin-bottom: 12px">
            归档后正文锁定，信息写入数据库。需先完成分析并保存。
          </p>
          <n-button
            type="primary"
            size="small"
            @click="doArchive"
            :loading="archiving"
            :disabled="!analysis || chapter.status === 'archived'"
            block
          >{{ chapter.status === 'archived' ? '已归档' : '归档' }}</n-button>
        </div>

        <!-- 候选配置弹窗 -->
        <n-modal v-model:show="showConfigModal" title="候选配置" preset="card" style="width: 520px">
          <div v-if="viewingDraftConfig" style="font-size: 13px; line-height: 2">
            <template v-if="viewingDraftConfig.providerName || viewingDraftConfig.model">
              <div><strong>模型：</strong>{{ viewingDraftConfig.providerName || '' }} / {{ viewingDraftConfig.model || '' }}</div>
            </template>
            <div v-if="viewingDraftConfig.temperature !== undefined"><strong>Temperature：</strong>{{ viewingDraftConfig.temperature }}</div>
            <div v-if="viewingDraftConfig.maxTokens"><strong>Max Tokens：</strong>{{ viewingDraftConfig.maxTokens }}</div>
            <div><strong>角色：</strong>{{ (viewingDraftConfig.characterIds || []).length }} 个</div>
            <div><strong>记忆：</strong>{{ (viewingDraftConfig.memoryTypeIds || []).length }} 个</div>
            <div><strong>剧情弧线：</strong>{{ (viewingDraftConfig.plotArcIds || []).length }} 个</div>
            <div><strong>世界观：</strong>{{ (viewingDraftConfig.loreIds || []).length }} 个</div>
            <div v-if="viewingDraftConfig.outline" style="margin-top: 8px">
              <strong>大纲：</strong>
              <pre style="margin: 4px 0 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: var(--text-secondary)">{{ viewingDraftConfig.outline }}</pre>
            </div>
          </div>
        </n-modal>

        <!-- 归档确认弹窗 -->
        <n-modal v-model:show="showArchiveModal" title="归档确认" preset="card" style="width: 480px">
          <template v-if="archiveErrors && Object.keys(archiveErrors).length > 0">
            <p style="color: var(--color-negative); margin-bottom: 8px; font-weight: 600">分析中存在失败项，无法归档：</p>
            <ul style="margin-bottom: 16px; padding-left: 20px; line-height: 1.8">
              <li v-for="(msg, key) in archiveErrors" :key="key">
                <strong>{{ analyzerLabels[key] || key }}</strong>：{{ msg }}
              </li>
            </ul>
            <n-space justify="end">
              <n-button @click="showArchiveModal = false">关闭</n-button>
              <n-button type="primary" :loading="analyzeRunning" @click="reAnalyzeFailed">
                重新分析失败项
              </n-button>
            </n-space>
          </template>
          <template v-else-if="archiveStep === 1 && hashMismatch">
            <p style="color: var(--color-negative); margin-bottom: 12px">正文已修改但未重新分析（正文哈希与分析版本不一致）。</p>
            <p style="margin-bottom: 16px">是否继续归档？建议先重新分析以确保数据一致。</p>
            <n-space justify="end">
              <n-button @click="showArchiveModal = false">取消</n-button>
              <n-button type="warning" @click="archiveStep = 2">继续归档</n-button>
            </n-space>
          </template>
          <template v-else-if="archiveStep <= 2 && newCharacters.length > 0">
            <p style="margin-bottom: 8px">归档将新增以下角色：</p>
            <ul style="margin-bottom: 16px; padding-left: 20px">
              <li v-for="c in newCharacters" :key="c.slug"><strong>{{ c.name }}</strong>（{{ c.slug }}）<span v-if="c.identity?.length"> — {{ c.identity.join('、') }}</span></li>
            </ul>
            <n-space justify="end">
              <n-button @click="showArchiveModal = false">取消</n-button>
              <n-button type="primary" @click="archiveStep = 3">确认</n-button>
            </n-space>
          </template>
          <template v-else>
            <p style="margin-bottom: 12px">即将归档，归档后章节内容锁定不可修改。</p>
            <p style="color: var(--text-tertiary); font-size: 12px; margin-bottom: 16px">是否继续？</p>
            <n-space justify="end">
              <n-button @click="showArchiveModal = false">取消</n-button>
              <n-button type="primary" style="margin-left: 24px" @click="confirmArchive">确认归档</n-button>
            </n-space>
          </template>
        </n-modal>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NTag, NModal, NSpace, NPopconfirm, NSelect, NSlider, NInputNumber, NTabs, NTabPane, NCheckbox, NCheckboxGroup, NEmpty, NDynamicTags } from 'naive-ui'
import { v2ChaptersApi } from '../api-v2/chapters'
import { GRAPH_NODE_COLORS_V2, GRAPH_NODE_LABELS } from '../api-v2/graph'
import { useChapterConfig } from '../composables-v2/useChapterConfig'
import { useDraftStream } from '../composables-v2/useDraftStream'
import { useCytoscapeLifecycle, type GraphData as CyGraphData } from '../composables/graph/useCytoscapeLifecycle'

const statusLabels: Record<string, string> = {
  draft: '草稿', generating: '生成中', analyzing: '分析中', archived: '已归档'
}
const statusTagTypes: Record<string, 'default' | 'warning' | 'info' | 'success'> = {
  draft: 'default', generating: 'warning', analyzing: 'info', archived: 'success'
}

const route = useRoute()
const router = useRouter()
const chapter = ref<any>(null)
const loading = ref(false)
const content = ref('')
const outline = ref('')
const toastMsg = ref('')
const toastType = ref<'success' | 'error' | 'warning'>('success')
const savingOutline = ref(false)

// ── 候选文章（composable 管理） ──
const {
  drafts, activeDraftTab, generatingCount,
  loadDrafts, startGeneration, cancelGeneration, deleteDraft,
  draftWordCount, dispose: disposeDrafts
} = useDraftStream(
  () => route.params.chapterId as string,
  showToast
)

// 分步可见性
const step = ref(1)

// Prompt 预览
const assembledPrompt = ref<{
  systemMessage: string; userMessage: string
  estimatedSystemTokens?: number; estimatedUserTokens?: number
  estimatedTotalTokens?: number; contextBudget?: number
} | null>(null)
const generatingPrompt = ref(false)

// 分析
const analysis = ref<any>(null)
const editableAnalysis = ref<any>(null)
const savingEdits = ref(false)
const analyzeRunning = ref(false)
const regenerating = ref<string | null>(null)

// 图谱分析面板 — 迷你 Cytoscape
const analysisActiveTab = ref<string>('characters')
const analysisCyContainer = ref<HTMLDivElement>()
const showGraphEditor = ref(false)
const graphTypeOptions = [
  { label: '角色', value: 'character' }, { label: '势力', value: 'faction' },
  { label: '事件', value: 'event' }, { label: '物品', value: 'item' },
  { label: '地点', value: 'location' }, { label: '其他', value: 'other' }
]

const chapterTypeStats = computed(() => {
  const stats: Record<string, number> = {}
  const nodes = getAnalyzerData('graph')?.chapterGraph?.nodes
  if (nodes) {
    for (const n of nodes) { stats[n.type] = (stats[n.type] || 0) + 1 }
  }
  return stats
})

/** 将本章图谱转为 cytoscape 格式 */
function toAnalysisCyData(): CyGraphData | null {
  const cg = getAnalyzerData('graph')?.chapterGraph
  if (!cg?.nodes?.length) return null
  const keyToType = new Map<string, string>()
  for (const n of cg.nodes) { keyToType.set(n.key, n.type) }
  return {
    nodes: cg.nodes.map((n: any) => ({ id: `${n.type}:${n.key}`, type: n.type, key: n.key, label: n.label, ...n.data })),
    edges: cg.edges.map((e: any) => ({
      source: `${keyToType.get(e.fromKey) || 'other'}:${e.fromKey}`,
      target: `${keyToType.get(e.toKey) || 'other'}:${e.toKey}`,
      relation: e.relation,
      fromType: keyToType.get(e.fromKey) || 'other', fromKey: e.fromKey,
      toType: keyToType.get(e.toKey) || 'other', toKey: e.toKey
    }))
  }
}

function getAnalysisNodeColor(type: string): string {
  return GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other
}

const analysisCytoscape = useCytoscapeLifecycle({
  containerRef: analysisCyContainer,
  getDisplayData: () => toAnalysisCyData(),
  getNodeColor: getAnalysisNodeColor
})

function refreshAnalysisGraph() {
  setTimeout(() => analysisCytoscape.init(), 0)
}

// 监听图谱数据变化
watch(() => getAnalyzerData('graph')?.chapterGraph, () => {
  refreshAnalysisGraph()
}, { deep: true })

// 切换到图谱 tab 时重建 cytoscape（之前容器为 display:none 时尺寸为 0）
watch(analysisActiveTab, (tab) => {
  if (tab === 'graph') refreshAnalysisGraph()
})
const reverting = ref(false)
const hashMismatch = ref(false)
const newCharacters = ref<any[]>([])

watch(() => analysis.value, (val) => {
  if (val) {
    const copy = JSON.parse(JSON.stringify(val))
    if (copy.characters?.items) {
      for (const c of copy.characters.items) {
        c.relationshipsText = typeof c.relationships === 'object' ? JSON.stringify(c.relationships, null, 2) : (c.relationships || '{}')
        c.statusText = typeof c.status === 'object' ? JSON.stringify(c.status, null, 2) : (c.status || '{}')
      }
    }
    editableAnalysis.value = copy
  }
}, { deep: true })

const analyzerLabels: Record<string, string> = {
  characters: '角色', memories: '记忆', plotArcs: '剧情弧线', timeline: '时间线', graph: '图谱'
}

const memCatOptions = [
  { label: '关系变化', value: 'relationship_change' },
  { label: '伏笔', value: 'foreshadowing' },
  { label: '情感变化', value: 'emotional_change' },
  { label: '事件记忆', value: 'event_memory' },
]
const arcActionOptions = [
  { label: '新增', value: 'create' }, { label: '更新', value: 'update' }, { label: '关闭', value: 'close' },
]
const arcStatusOptions = [
  { label: '活跃', value: 'active' }, { label: '中断', value: 'interrupted' }, { label: '完成', value: 'completed' }, { label: '关闭', value: 'closed' },
]

function getAnalyzerData(key: string) {
  return editableAnalysis.value?.[key] || {}
}

const mergedTypeStats = computed(() => {
  const stats: Record<string, number> = {}
  const nodes = getAnalyzerData('graph')?.mergedGraph?.nodes
  if (nodes) {
    for (const n of nodes) {
      stats[n.type] = (stats[n.type] || 0) + 1
    }
  }
  return stats
})

async function saveEdits() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || !editableAnalysis.value) return
  savingEdits.value = true
  try {
    const payload = JSON.parse(JSON.stringify(editableAnalysis.value))
    const jsonErrors: string[] = []
    if (payload.characters?.items) {
      for (const c of payload.characters.items) {
        const relText = (c.relationshipsText || '').trim()
        if (relText) {
          try { c.relationships = JSON.parse(relText) } catch {
            jsonErrors.push(`角色「${c.name}」的关系 JSON 格式错误`)
          }
        } else {
          c.relationships = {}
        }
        const statText = (c.statusText || '').trim()
        if (statText) {
          try { c.status = JSON.parse(statText) } catch {
            jsonErrors.push(`角色「${c.name}」的状态 JSON 格式错误`)
          }
        } else {
          c.status = {}
        }
      }
    }
    if (jsonErrors.length > 0) {
      showToast(`JSON 格式错误，无法保存: ${jsonErrors.join('；')}`, 'error')
      return
    }
    editableAnalysis.value = payload
    const res = await v2ChaptersApi.savePendingAnalysis(chapterId, payload)
    if (!res.data.success) { showToast(res.data.message || '保存调整失败', 'warning'); return }
    analysis.value = JSON.parse(JSON.stringify(payload))
    showToast('分析调整已保存')
    updateStep()
  } catch (err: any) { showToast(err?.message || '保存调整失败', 'error') } finally { savingEdits.value = false }
}

const analyzerItems = computed(() => {
  return Object.keys(analyzerLabels).map(key => {
    const data = analysis.value?.[key]
    const status: string = data?.status || 'idle'
    let summary = '', error = ''
    if (status === 'success') {
      switch (key) {
        case 'characters': { const items = data.items || []; const newCount = items.filter((c: any) => c.isNew).length; summary = `${items.length} 个角色${newCount > 0 ? `（${newCount} 个新角色）` : ''}`; break }
        case 'memories': { const c = (data.chapterMemories || []).length; const g = (data.globalMemories || []).length; const s = (data.sceneMemories || []).length; summary = `章节记忆 ${c} + 全局记忆 ${g} + 场景记忆 ${s}`; break }
        case 'plotArcs': { const arcs = data.arcs || []; const create = arcs.filter((a: any) => a.action === 'create').length; const update = arcs.filter((a: any) => a.action === 'update').length; summary = `新增 ${create} + 更新 ${update}`; break }
        case 'timeline': { const evts = data.events || []; const major = evts.filter((e: any) => e.importance === 'major').length; summary = `${evts.length} 个事件${major > 0 ? `（${major} 重要）` : ''}`; break }
        case 'graph': {
          const cg = data.chapterGraph || {}
          const mg = data.mergedGraph || {}
          summary = `本章 ${(cg.nodes || []).length} 节点/${(cg.edges || []).length} 边 · 总图谱 ${(mg.nodes || []).length} 节点/${(mg.edges || []).length} 边`
          break
        }
      }
    } else if (status === 'failed') { error = data.error || 'AI 调用失败' }
    return { key, label: analyzerLabels[key], status, summary, error }
  })
})

// 归档
const archiving = ref(false)
const showArchiveModal = ref(false)
const archiveStep = ref(1)
const archiveErrors = ref<Record<string, string> | null>(null)
const saving = ref(false)

// ── 配置（composable 管理） ──
const {
  availableCharacters, availableMemories, availablePlotArcs, availableLore,
  modelOptions,
  configProviderId, configTemperature, configMaxTokens,
  configCharacterIds, configMemoryIds, configPlotArcIds, configLoreIds,
  searchingMemories,
  selectedModel, parsedConfig,
  buildGenConfig, buildConfigForSave, loadAvailableSources, handleMemorySearch
} = useChapterConfig(
  () => route.params.storyId as string,
  () => route.params.chapterId as string,
  chapter
)

function statusLabel(s: string) { return statusLabels[s] || s }
function statusTagType(s: string) { return statusTagTypes[s] || 'default' }

function goBack() {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/chapters`)
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
  toastMsg.value = msg
  toastType.value = type
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2500)
}

function toastGraphWarnings(warnings?: string[]) {
  if (!warnings || warnings.length === 0) return
  showToast(warnings.join('；'), 'warning')
}

// ── 分步计算：基于已保存数据推断当前步骤 ──
function updateStep() {
  if (chapter.value?.status === 'archived') { step.value = 5; return }
  if (analysis.value) { step.value = 5; return }
  if (chapter.value?.content) { step.value = 4; return }
  if (assembledPrompt.value || drafts.value.length > 0) { step.value = 3; return }
  if (outline.value.trim() && parsedConfig.value && Object.keys(parsedConfig.value).length > 1) { step.value = 2; return }
  step.value = 1
}

// ── 数据加载 ──

async function loadChapter() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  loading.value = true
  try {
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = res.data.data
    content.value = chapter.value?.content || ''
    outline.value = chapter.value?.outline || ''
  } finally { loading.value = false }
}

async function loadAndApplyConfig() {
  const { restoredPrompt } = await loadAvailableSources()
  if (restoredPrompt) assembledPrompt.value = restoredPrompt
  updateStep()
}

function onMemorySearch() {
  handleMemorySearch(outline.value.trim(), showToast)
}

function onCharacterAutoSelect() {
  const text = outline.value.trim()
  if (!text) return
  const matched: string[] = []
  for (const c of availableCharacters.value) {
    const name = (c.name || '').trim()
    const slug = (c.slug || '').trim()
    if ((name && text.includes(name)) || (slug && text.includes(slug))) {
      matched.push(c.id)
    }
  }
  configCharacterIds.value = matched
  showToast(matched.length > 0 ? `大纲中匹配到 ${matched.length} 个角色` : '大纲中未匹配到角色名', matched.length > 0 ? 'success' : 'warning')
}

// ── 保存 ──

async function saveContent() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  saving.value = true
  try {
    const res = await v2ChaptersApi.update(chapterId, { content: content.value })
    chapter.value = res.data.data
    showToast('正文已保存')
    updateStep()
  } finally { saving.value = false }
}

async function saveOutline() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  savingOutline.value = true
  try {
    const res = await v2ChaptersApi.update(chapterId, { outline: outline.value })
    chapter.value = res.data.data
    showToast('大纲已保存')
    updateStep()
  } finally { savingOutline.value = false }
}

// ── Prompt 生成 ──

async function handleGeneratePrompt() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || !outline.value.trim()) return

  // 保存配置（含 current prompt 快照）
  const cfg = { ...(parsedConfig.value || {}), ...buildConfigForSave() }

  generatingPrompt.value = true
  try {
    await v2ChaptersApi.update(chapterId, { outline: outline.value, config: cfg })
    const res = await v2ChaptersApi.preview(chapterId, buildGenConfig(outline.value.trim()))
    if (res.data?.success && res.data.data) {
      assembledPrompt.value = res.data.data
      cfg._lastPrompt = res.data.data
      try { await v2ChaptersApi.update(chapterId, { config: cfg }) } catch (promptSaveErr: any) {
        console.warn(`[V2-Design] 写回 _lastPrompt 失败，下次打开将不显示历史 prompt: ${promptSaveErr?.message || promptSaveErr}`)
      }
      step.value = 3
      await loadDrafts()
    }
  } catch (err: any) { showToast(err?.message || '生成 Prompt 失败', 'error') }
  finally { generatingPrompt.value = false }
}

// ── 候选文章 ──

function handleGenerate() {
  if (!outline.value.trim()) return
  startGeneration(buildGenConfig(outline.value.trim()))
}

const showConfigModal = ref(false)
const viewingDraftConfig = ref<any>(null)

function openDraftConfig(draft: any) {
  try {
    viewingDraftConfig.value = typeof draft.config === 'string' ? JSON.parse(draft.config) : (draft.config || {})
  } catch (err: any) {
    console.warn(`[V2] draft.config JSON 解析失败，显示空配置: ${(draft.config || '').slice(0, 80)}`, err)
    viewingDraftConfig.value = {}
  }
  showConfigModal.value = true
}

function adoptDraft(draft: any) {
  content.value = draft.content
  showToast('已采用候选内容到正文编辑区，记得保存正文')
}

// ── 分析 ──

async function loadAnalysis() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  try {
    const res = await v2ChaptersApi.getAnalysis(chapterId)
    if (res.data.data) {
      const a = res.data.data.analysis
      analysis.value = (a && typeof a === 'object' && Object.keys(a).length > 0) ? a : null
      hashMismatch.value = res.data.data.isStale
    }
    updateStep()
  } catch (err: any) {
    showToast(err?.message || '加载分析结果失败', 'error')
  }
}

async function runAnalyze() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || analyzeRunning.value) return
  analyzeRunning.value = true
  try {
    const res = await v2ChaptersApi.analyze(chapterId)
    if (!res.success) { showToast(res.error || '分析失败', 'warning'); return }
    const { pending, allSuccess } = res.data
    analysis.value = pending
    if (allSuccess) {
      await refreshChapter()
      updateStep()
      showToast('全部分析完成')
    } else {
      const failed = Object.entries(pending).filter(([, v]: [any, any]) => v.status === 'failed').map(([k]) => analyzerLabels[k] || k)
      showToast(`${failed.join('、')} 分析失败`, 'warning')
    }
    toastGraphWarnings(pending?.graph?.warnings)
  } catch (err: any) { showToast(err?.message || '分析请求失败', 'error') }
  finally { analyzeRunning.value = false }
}

async function regenerateSingle(key: string) {
  const chapterId = route.params.chapterId as string
  if (!chapterId || regenerating.value) return
  regenerating.value = key
  try {
    const res = await v2ChaptersApi.analyzeSingle(chapterId, key)
    if (!res.success) {
      showToast(`重新生成失败: ${res.error || '未知错误'}`, 'warning')
      return
    }
    // 从服务端重新拉取分析数据，确保前端状态与 DB 一致
    await loadAnalysis()
    showToast(`${analyzerLabels[key]} 重新生成完成`)
    if (key === 'graph') toastGraphWarnings(analysis.value?.graph?.warnings)
  } catch (err: any) { showToast(err?.message || '重新生成请求失败', 'error') }
  finally { regenerating.value = null }
}

async function revertAnalysis() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  reverting.value = true
  try {
    const res = await v2ChaptersApi.revertAnalysis(chapterId)
    if (!res.data.success) { showToast((res.data as any).error || '撤销分析失败', 'warning'); return }
    analysis.value = null
    await refreshChapter()
    updateStep()
    showToast('已撤销分析，恢复为草稿状态')
  } catch (err: any) { showToast(err?.message || '撤销分析请求失败', 'error') }
  finally { reverting.value = false }
}

async function refreshChapter() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  const res = await v2ChaptersApi.detail(chapterId)
  chapter.value = res.data.data
}

// ── 归档 ──

async function doArchive() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  await loadAnalysis()
  archiveStep.value = 1
  archiveErrors.value = null
  try {
    const res = await v2ChaptersApi.preArchive(chapterId)
    if (res.data.data) {
      hashMismatch.value = res.data.data.hashMismatch
      newCharacters.value = res.data.data.newCharacters || []
      archiveErrors.value = res.data.data.errors && Object.keys(res.data.data.errors).length > 0
        ? res.data.data.errors
        : null
    }
  } catch (err: any) {
    showToast(err?.message || '准备归档失败', 'error')
  }
  if (archiveErrors.value) { archiveStep.value = 0 }
  else if (hashMismatch.value) { archiveStep.value = 1 }
  else if (newCharacters.value.length > 0) { archiveStep.value = 2 }
  else { archiveStep.value = 3 }
  showArchiveModal.value = true
}

async function reAnalyzeFailed() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || analyzeRunning.value) return
  const failedKeys = archiveErrors.value ? Object.keys(archiveErrors.value) : []
  if (failedKeys.length === 0) return
  analyzeRunning.value = true
  try {
    for (const key of failedKeys) {
      const res: any = await v2ChaptersApi.analyzeSingle(chapterId, key)
      if (!res?.success) { showToast(`${analyzerLabels[key]} 重抽失败: ${res?.error || '未知'}`, 'warning') }
    }
    await loadAnalysis()
    showArchiveModal.value = false
    archiveErrors.value = null
  } catch (err: any) {
    showToast(err?.message || '重新分析请求失败', 'error')
  } finally { analyzeRunning.value = false }
}

async function confirmArchive() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  archiving.value = true
  showArchiveModal.value = false
  try {
    await v2ChaptersApi.archive(chapterId)
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = res.data.data
    analysis.value = null
    newCharacters.value = []
    archiveErrors.value = null
  } catch (err: any) {
    const apiErr = err?.response?.data
    if (apiErr?.data?.errors) {
      archiveErrors.value = apiErr.data.errors
      showArchiveModal.value = true
      showToast('分析中存在失败项，无法归档', 'error')
    } else {
      showToast(err?.message || '归档失败', 'error')
    }
  } finally { archiving.value = false }
}

watch(() => route.params.chapterId, () => {
  loadChapter().then(() => loadAndApplyConfig())
  loadDrafts()
  loadAnalysis()
})
onMounted(() => {
  if (route.params.chapterId) {
    loadChapter().then(() => loadAndApplyConfig())
    loadDrafts()
    loadAnalysis()
  }
})
onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
  disposeDrafts()
})
</script>

<style scoped>
.toast-bar {
  position: sticky; top: 0; z-index: 10;
  padding: 10px 16px; border-radius: 6px; font-size: 13px; font-weight: 500;
  margin-bottom: 12px; text-align: center;
  animation: toast-in 0.25s ease;
}
.toast-bar.success { background: #e6f7e6; color: #2e7d32; border: 1px solid #a5d6a7; }
.toast-bar.warning { background: #fff8e1; color: #e65100; border: 1px solid #ffcc02; }
.toast-bar.error   { background: #fdecea; color: #c62828; border: 1px solid #ef9a9a; }
@keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

.design-flow { display: flex; flex-direction: column; gap: 16px; }
.split-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.split-left, .split-right { min-width: 0; }
.tab-content { max-height: 260px; overflow-y: auto; padding-top: 4px; }
.draft-body { max-height: 360px; overflow-y: auto; margin-bottom: 8px; }
.draft-content { font-family: var(--font-serif); font-size: 13px; line-height: 1.8; white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--text-primary); }
.draft-footer { display: flex; justify-content: space-between; align-items: center; }
.draft-word-count { font-size: 12px; color: var(--text-tertiary); font-family: monospace; }
.draft-footer-actions { display: flex; gap: 4px; align-items: center; }
.config-field { margin-bottom: 10px; }
.config-field:last-child { margin-bottom: 0; }
.config-field__label { display: block; font-size: 12px; color: var(--text-tertiary); margin-bottom: 3px; }
.prompt-preview { font-family: var(--font-serif); font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; margin: 0; padding: 12px; background: var(--bg-subtle); border-radius: 6px; max-height: 320px; overflow-y: auto; color: var(--text-secondary); }
.analyzer-tab-content { padding: 12px 0; min-height: 60px; max-height: 420px; overflow-y: auto; }
.analyzer-idle { color: var(--text-tertiary); font-size: 12px; margin: 0; }
.char-row { padding: 8px 0; border-bottom: 1px solid var(--border-color); }
.char-row:last-child { border-bottom: none; }
.char-row__head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.char-row__slug { font-size: 11px; color: var(--text-tertiary); font-family: monospace; }
.char-row__field { display: flex; align-items: flex-start; gap: 6px; margin-top: 4px; }
.tag-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; min-width: 32px; }
.mem-section { margin-bottom: 14px; }
.mem-section__title { font-size: 13px; font-weight: 500; margin: 0 0 6px; display: flex; align-items: center; gap: 6px; }
.mem-count { font-size: 11px; color: var(--text-tertiary); font-weight: normal; }
.mem-row { padding: 6px 0; border-bottom: 1px solid var(--border-color); }
.mem-row:last-child { border-bottom: none; }
.mem-row__head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.mem-row__imp-label { font-size: 11px; color: var(--text-tertiary); margin-right: 4px; }
.arc-row { padding: 8px 0; border-bottom: 1px solid var(--border-color); }
.arc-row:last-child { border-bottom: none; }
.arc-row__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.time-row { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-color); }
.time-row:last-child { border-bottom: none; }
.time-row__order { font-family: monospace; font-size: 11px; color: var(--text-tertiary); min-width: 20px; padding-top: 5px; }
.time-row__body { flex: 1; min-width: 0; }
.time-row__head { display: flex; align-items: center; gap: 6px; }
.time-row__meta { display: flex; gap: 6px; margin-top: 4px; }
.time-row__time { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.analyzer-item__tag { font-size: 11px; color: var(--text-tertiary); }
.analyzer-item__tag.is-success { color: var(--color-positive); }
.analyzer-item__tag.is-failed { color: var(--color-negative); }
.analyzer-item__tag.is-loading { color: var(--color-warning); }
.analyzer-item__error { font-size: 12px; color: var(--color-negative); margin-top: 2px; }
.analysis-status { padding: 6px 10px; background: var(--bg-subtle); border-radius: 4px; font-family: monospace; }

/* 图谱分析面板 */
.graph-mini-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; font-weight: var(--weight-medium); }
.graph-mini-canvas { width: 100%; height: 260px; background: var(--bg-subtle); border-radius: 6px; border: 1px solid var(--border-subtle); }
.graph-mini-types { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
.graph-section { }
.graph-sub-title { font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px; }
.graph-node-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.graph-edge-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.graph-type-badge { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 11px; color: #fff; min-width: 40px; text-align: center; line-height: 1.5; }
.graph-edge-arrow { font-size: 12px; color: var(--text-tertiary); }
.graph-merged-types { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.graph-type-chip { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; }
.graph-type-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
</style>
