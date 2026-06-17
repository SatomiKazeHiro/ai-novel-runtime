<template>
    <div>
        <!-- ========== 分支树视图 ========== -->
        <div v-if="!editor.editMode">
            <n-space
                justify="space-between"
                align="center"
                style="margin-bottom: 16px"
            >
                <n-h1>章节工作台</n-h1>
                <n-button
                    v-if="tree.chapterTree.length === 0"
                    type="primary"
                    @click="tree.openCreateRoot"
                    >新建根章节</n-button
                >
            </n-space>

            <n-card v-if="tree.loading" size="small">
                <n-skeleton text :repeat="3" />
            </n-card>

            <n-empty
                v-else-if="tree.chapterTree.length === 0"
                description="暂无章节，点击新建根章节开始创作"
            />

            <ChapterBranchTree
                v-else
                :tree-data="tree.chapterTree"
                :selected-id="tree.selectedChapterId"
                @select="tree.onNodeSelect"
                @develop="tree.onDevelop"
                @edit="handleOpenEdit"
                @view="handleOpenView"
                @delete="tree.onDelete"
            />
        </div>

        <!-- ========== 编辑子页面 ========== -->
        <div v-else>
            <!-- 顶部导航 -->
            <n-space align="center" style="margin-bottom: 24px">
                <n-button @click="handleBackToTree">
                    <template #icon
                        ><n-icon><ArrowBackOutline /></n-icon
                    ></template>
                    返回
                </n-button>
                <n-divider vertical />
                <n-input
                    v-model:value="editor.editTitle"
                    style="width: 320px; font-size: 16px; font-weight: 600"
                    placeholder="章节标题"
                />
                <n-tag
                    v-if="editor.currentChapter?.isSideStory"
                    size="small"
                    type="warning"
                    >番外</n-tag
                >
                <n-tag
                    size="small"
                    :type="statusTagType(editor.currentChapter?.status)"
                    >{{ editor.currentChapter?.status }}</n-tag
                >
                <n-tag v-if="isReadonly" size="small" type="info">只读</n-tag>
            </n-space>

            <!-- Step 1: 配置区 -->
            <n-card title="Step 1：配置区" style="margin-bottom: 24px">
                <n-grid :cols="3" :x-gap="12">
                    <n-grid-item>
                        <n-form-item
                            label="写作人格"
                            label-placement="left"
                            label-width="80"
                        >
                            <n-select
                                v-model:value="editor.selectedProfileId"
                                :options="editor.profileOptions"
                                style="width: 280px"
                                placeholder="选择写作人格"
                                :disabled="isReadonly"
                            />
                        </n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item
                            label="运行模型"
                            label-placement="left"
                            label-width="80"
                        >
                            <n-select
                                v-model:value="editor.selectedModelId"
                                :options="editor.modelOptions"
                                style="width: 280px"
                                placeholder="选择运行模型"
                                clearable
                                :disabled="isReadonly"
                            />
                        </n-form-item>
                    </n-grid-item>
                </n-grid>

                <n-divider />

                <!-- 剧情弧线 -->
                <n-form label-placement="left" label-width="80">
                    <n-form-item
                        label="剧情弧线"
                        v-if="editor.plotArcs.length > 0"
                    >
                        <n-grid :cols="3" :x-gap="12" :y-gap="12">
                            <n-grid-item
                                v-for="arc in editor.plotArcs"
                                :key="arc.id"
                            >
                                <n-card size="small" :bordered="false" embedded>
                                    <n-space
                                        justify="space-between"
                                        align="center"
                                    >
                                        <n-text strong>{{ arc.name }}</n-text>
                                        <n-space>
                                            <n-tag
                                                size="tiny"
                                                :type="
                                                    arc.type === 'main'
                                                        ? 'error'
                                                        : 'default'
                                                "
                                                >{{
                                                    arc.type === "main"
                                                        ? "主线"
                                                        : "支线"
                                                }}</n-tag
                                            >
                                            <n-tag
                                                size="tiny"
                                                :type="
                                                    arcStatusType(arc.status)
                                                "
                                                >{{ arc.status }}</n-tag
                                            >
                                        </n-space>
                                    </n-space>
                                    <n-progress
                                        :percentage="arc.progress"
                                        :show-indicator="false"
                                        :height="6"
                                        style="margin: 8px 0"
                                    />
                                    <n-text depth="3" style="font-size: 12px"
                                        >当前：{{
                                            arc.currentStage || "未知"
                                        }}
                                        | 目标：{{
                                            arc.nextGoal || "待定"
                                        }}</n-text
                                    >
                                </n-card>
                            </n-grid-item>
                        </n-grid>
                    </n-form-item>

                    <n-divider />

                    <n-form-item label="大纲">
                        <n-input
                            v-model:value="editor.editForm.outline"
                            type="textarea"
                            :rows="12"
                            placeholder="输入章节大纲..."
                            :readonly="isReadonly"
                        />
                    </n-form-item>
                    <n-text
                        v-if="editor.editForm.outline"
                        style="padding-left: 80px; --n-text-color: rgb(118, 124, 130)"
                    >
                            总字数：{{ editor.editForm.outline.length }}字
                    </n-text>

                    <n-divider />

                    <n-grid :cols="3" :x-gap="16">
                        <n-grid-item>
                            <n-form-item label="地点"
                                ><n-input
                                    v-model:value="
                                        editor.editForm.sceneLocation
                                    "
                                    placeholder="场景地点，如：青云宗藏书阁地下三层"
                                    :readonly="isReadonly"
                            /></n-form-item>
                        </n-grid-item>
                        <n-grid-item>
                            <n-form-item label="氛围"
                                ><n-input
                                    v-model:value="editor.editForm.sceneMood"
                                    placeholder="氛围，如：紧张、压抑、随时可能被发现"
                                    :readonly="isReadonly"
                            /></n-form-item>
                        </n-grid-item>
                        <n-grid-item>
                            <n-form-item label="目标"
                                ><n-input
                                    v-model:value="editor.editForm.sceneGoal"
                                    placeholder="目标，如：找到上古残卷并不被守卫察觉"
                                    :readonly="isReadonly"
                            /></n-form-item>
                        </n-grid-item>
                    </n-grid>
                    <n-text
                        depth="3"
                        style="
                            font-size: 12px;
                            display: block;
                            padding-left: 80px;
                        "
                    >
                        💡 AI
                        会基于这些信息来铺陈环境描写、控制情绪节奏、推动情节走向目标。如果你只写大纲但不填场景，这里会显示"未设定"，AI
                        的自由度更高，但也更容易跑题。
                    </n-text>
                </n-form>

                <template v-if="!isReadonly">
                    <n-divider />
                    <n-button
                        type="primary"
                        @click="debouncedSaveConfig"
                        size="small"
                        >保存配置</n-button
                    >
                </template>
            </n-card>

            <!-- Step 2: Prompt -->
            <n-card
                v-if="!isReadonly"
                title="Step 2：Prompt"
                style="margin-bottom: 24px"
            >
                <n-form-item label="Prompt 内容">
                    <n-input
                        v-model:value="prompt.editablePrompt"
                        type="textarea"
                        :rows="10"
                        placeholder="点击「生成 Prompt」按钮生成 Prompt..."
                        readonly
                    />
                </n-form-item>

                <n-space style="margin-bottom: 12px">
                    <n-button
                        type="primary"
                        @click="handleGeneratePrompt"
                        :loading="prompt.previewLoading"
                        >生成 Prompt</n-button
                    >
                    <n-button
                        @click="prompt.copyPrompt"
                        :disabled="!prompt.editablePrompt"
                        >复制 Prompt</n-button
                    >
                </n-space>

                <!-- Prompt 预算 -->
                <n-card
                    v-if="prompt.tokenStats"
                    size="small"
                    style="margin-bottom: 12px"
                    :bordered="false"
                >
                    <n-space vertical>
                        <n-space justify="space-between" align="center">
                            <n-text strong>Prompt 预算</n-text>
                            <n-space>
                                <n-tag
                                    size="small"
                                    :type="
                                        prompt.tokenStats.totalTokens >
                                        prompt.DANGER_THRESHOLD
                                            ? 'error'
                                            : prompt.tokenStats.totalTokens >
                                                prompt.WARN_THRESHOLD
                                              ? 'warning'
                                              : 'success'
                                    "
                                >
                                    {{
                                        prompt.tokenStats.totalTokens.toLocaleString()
                                    }}
                                    /
                                    {{
                                        prompt.MODEL_MAX_TOKENS.toLocaleString()
                                    }}
                                    tokens
                                </n-tag>
                                <n-tag
                                    v-if="
                                        prompt.layerStats.some(
                                            (l: any) => l.truncated,
                                        )
                                    "
                                    size="small"
                                    type="error"
                                    >⚠️ 有层被截断</n-tag
                                >
                            </n-space>
                        </n-space>
                        <n-progress
                            :percentage="
                                Math.min(
                                    100,
                                    Math.round(
                                        (prompt.tokenStats.totalTokens /
                                            prompt.MODEL_MAX_TOKENS) *
                                            100,
                                    ),
                                )
                            "
                            :status="
                                prompt.tokenStats.totalTokens >
                                prompt.CRITICAL_THRESHOLD
                                    ? 'error'
                                    : prompt.tokenStats.totalTokens >
                                        prompt.WARN_THRESHOLD
                                      ? 'warning'
                                      : 'success'
                            "
                            :show-indicator="false"
                            :height="12"
                        />
                    </n-space>
                </n-card>
            </n-card>

            <!-- Step 3: 正文编辑 -->
            <n-card
                title="Step 3：正文编辑"
                v-if="!isReadonly"
                style="margin-bottom: 24px"
            >
                <n-grid :cols="2" :x-gap="16" style="min-height: 480px">
                    <!-- 左侧：候选生成区 -->
                    <n-grid-item>
                        <n-space align="center" style="margin-bottom: 12px">
                            <n-button
                                type="primary"
                                size="small"
                                @click="handleGenerateDefault"
                                :loading="drafts.generating"
                                :disabled="drafts.generating"
                            >
                                {{ drafts.generating ? "生成中..." : "默认候选 ×3" }}
                            </n-button>
                            <n-button
                                size="small"
                                @click="drafts.showCustomModal = true"
                                :disabled="drafts.generating"
                                >自定义 ×1</n-button
                            >
                            <n-text v-if="drafts.generating" depth="3" style="font-size: 12px">AI 创作中...</n-text>
                        </n-space>

                        <!-- 候选 Tabs -->
                        <n-tabs
                            v-if="drafts.drafts.length > 0"
                            type="card"
                            size="small"
                        >
                            <n-tab-pane
                                v-for="draft in drafts.drafts"
                                :key="draft.id"
                                :name="draft.id"
                                :tab="draft.version"
                            >
                                <n-tabs type="segment" size="small" style="max-height: 360px">
                                    <n-tab-pane name="content" tab="结果">
                                        <n-scrollbar style="max-height: 300px">
                                            <n-space
                                                v-if="draft.status === 'generating'"
                                                vertical
                                                align="center"
                                                style="padding: 40px 0"
                                            >
                                                <n-spin size="medium" />
                                                <n-text depth="3" style="font-size: 12px">AI 正在创作中...</n-text>
                                            </n-space>
                                            <n-space
                                                v-else-if="draft.status === 'failed'"
                                                vertical
                                                align="center"
                                                style="padding: 20px 0"
                                            >
                                                <n-text type="error" style="font-size: 13px">生成失败</n-text>
                                                <n-text depth="3" style="font-size: 12px">{{ draft.errorMessage || "未知错误" }}</n-text>
                                            </n-space>
                                            <n-p
                                                v-else
                                                style="white-space: pre-wrap; line-height: 1.8; font-size: 13px;"
                                            >{{ draft.content || "暂无内容" }}</n-p>
                                        </n-scrollbar>
                                    </n-tab-pane>
                                    <n-tab-pane name="prompt" tab="Prompt">
                                        <n-scrollbar style="max-height: 300px">
                                            <n-p style="white-space: pre-wrap; font-size: 12px; color: #666;">
                                                {{ prompt.formatCompiledPrompt(draft.compiledPrompt) }}
                                            </n-p>
                                        </n-scrollbar>
                                    </n-tab-pane>
                                    <n-tab-pane name="params" tab="参数">
                                        <n-space vertical size="small" style="font-size: 12px">
                                            <n-text>temperature: {{ draft.temperature }}</n-text>
                                            <n-text>maxTokens: {{ draft.maxTokens }}</n-text>
                                            <n-text>model: {{ formatParams(draft.params).model }}</n-text>
                                            <n-text>耗时: {{ formatParams(draft.params).durationMs }}ms</n-text>
                                        </n-space>
                                    </n-tab-pane>
                                </n-tabs>

                                <n-divider style="margin: 8px 0" />
                                <n-space align="center" justify="space-between">
                                    <n-space>
                                        <n-button
                                            size="small"
                                            type="primary"
                                            @click="handleAdoptDraft(draft)"
                                            :disabled="draft.status === 'generating' || !draft.content"
                                        >采用此版本</n-button>
                                        <n-button
                                            size="small"
                                            @click="drafts.scoreDraft(draft.id)"
                                            :loading="drafts.scoringDraftId === draft.id"
                                            :disabled="!draft.content || (drafts.scoringDraftId !== null && drafts.scoringDraftId !== draft.id)"
                                        >评分</n-button>
                                        <n-button
                                            size="small"
                                            @click="drafts.confirmDeleteDraft(draft.id, draft.version)"
                                        >删除</n-button>
                                    </n-space>
                                    <n-text v-if="draft.content" depth="3" style="font-size: 12px">
                                        {{ draft.content.length.toLocaleString() }} 字
                                    </n-text>
                                </n-space>
                            </n-tab-pane>
                        </n-tabs>

                        <!-- 空状态 -->
                        <n-empty
                            v-else
                            description="暂无候选稿"
                            style="margin-top: 40px"
                        >
                            <template #extra>
                                <n-text depth="3" style="font-size: 12px">点击上方按钮生成，或直接编辑右侧正文</n-text>
                            </template>
                        </n-empty>
                    </n-grid-item>

                    <!-- 右侧：正文编辑区 -->
                    <n-grid-item>
                        <n-input
                            v-model:value="editor.editForm.content"
                            type="textarea"
                            :rows="22"
                            placeholder="在这里粘贴或编辑章节正文..."
                        />
                        <n-space align="center" justify="space-between" style="margin-top: 12px">
                            <n-space>
                                <n-button v-if="editor.currentChapter?.status !== 'archived'" type="primary" size="small" @click="editor.saveContent" :loading="editor.savingContent" :disabled="editor.savingContent">保存正文</n-button>
                                <n-button v-if="editor.currentChapter?.status === 'selected'" size="small" @click="handlePrepareArchive" :loading="archiving">准备归档</n-button>
                            </n-space>
                            <n-text depth="3" style="font-size: 13px">
                                {{ (editor.editForm.content || "").length.toLocaleString() }} 字
                            </n-text>
                        </n-space>
                    </n-grid-item>
                </n-grid>
            </n-card>

            <!-- Step 3.5: 归档审查 -->
            <reviewing-panel
                v-if="editor.currentChapter?.status === 'reviewing' && editor.pendingArchiveData"
                ref="reviewingPanelRef"
                :chapter="editor.currentChapter"
                :pending-archive-data="editor.pendingArchiveData"
                @save="handleSavePendingArchiveData"
                @confirm="handleConfirmArchive"
                @cancel="handleCancelReviewing"
            />

            <!-- reviewing 但无待归档数据：提示异常 -->
            <n-card
                v-else-if="editor.currentChapter?.status === 'reviewing'"
                title="归档审查"
                style="margin-bottom: 24px">
                <n-space vertical>
                    <n-alert type="error" :show-icon="false">
                        未能加载归档审查数据。可能是准备归档时提取失败，或数据解析异常。
                    </n-alert>
                    <!--
                        重新准备归档：后端允许从 reviewing 重试 prepare-archive
                        （会清掉旧 pendingArchiveData 并用新 payload 覆盖）。
                        用 warning 色而不是 primary/error，避免和"取消审查
                        （删除本章）"混淆——后者不可逆。
                    -->
                    <n-space>
                        <n-button
                            type="warning"
                            size="small"
                            :loading="repreparingArchive"
                            @click="handleReprepareArchive"
                        >重新准备归档</n-button>
                        <n-button type="error" size="small" @click="handleCancelReviewing">取消审查（删除本章）</n-button>
                    </n-space>
                </n-space>
            </n-card>

            <!-- Step 3 只读：正文展示 -->
            <n-card
                v-if="isReadonly"
                title="Step 3：正文"
                style="margin-bottom: 24px"
            >
                <n-input
                    v-model:value="editor.editForm.content"
                    type="textarea"
                    :rows="20"
                    readonly
                    style="margin-bottom: 12px"
                />
                <n-text depth="3" style="font-size: 13px">
                    总字数：{{
                        (editor.editForm.content || "").length.toLocaleString()
                    }}
                    字
                </n-text>
            </n-card>

            <!-- Step 4: 本章范围图谱 -->
            <n-card
                v-if="
                    editor.currentChapter?.status === 'archived' &&
                    editor.graphDelta
                "
                title="Step 4：本章范围图谱"
                style="margin-top: 24px"
            >
                <n-space vertical>
                    <n-collapse v-if="editor.graphDelta.nodes?.length > 0">
                        <n-collapse-item title="涉及节点">
                            <n-space>
                                <n-tag
                                    v-for="node in editor.graphDelta.nodes"
                                    :key="node.key"
                                    :type="
                                        node.type === 'character'
                                            ? 'error'
                                            : node.type === 'faction'
                                              ? 'warning'
                                              : 'default'
                                    "
                                >
                                    {{ node.label }} ({{ node.type }})
                                </n-tag>
                            </n-space>
                        </n-collapse-item>
                    </n-collapse>
                    <n-collapse v-if="editor.graphDelta.edges?.length > 0">
                        <n-collapse-item title="关系">
                            <n-space vertical size="small">
                                <n-text
                                    v-for="edge in editor.graphDelta.edges"
                                    :key="`${edge.fromKey}-${edge.relation}-${edge.toKey}`"
                                    style="font-size: 12px"
                                >
                                    {{ edge.fromLabel || edge.fromKey }} → [{{
                                        edge.relation
                                    }}] → {{ edge.toLabel || edge.toKey }}
                                </n-text>
                            </n-space>
                        </n-collapse-item>
                    </n-collapse>
                    <n-empty
                        v-if="
                            !editor.graphDelta.nodes?.length &&
                            !editor.graphDelta.edges?.length
                        "
                        description="本章未提取到图谱关系"
                    />
                </n-space>
            </n-card>
        </div>

        <!-- ========== 弹窗 ========== -->
        <!-- 新建根章节 -->
        <n-modal
            v-model:show="tree.showCreateModal"
            title="新建根章节"
            preset="card"
            style="width: 500px"
        >
            <n-form
                :model="tree.createForm"
                label-placement="left"
                label-width="80"
            >
                <n-form-item label="标题" required>
                    <n-input
                        v-model:value="tree.createForm.title"
                        placeholder="章节标题"
                    />
                </n-form-item>
                <n-form-item v-if="tree.chapterTree.length > 0">
                    <n-checkbox
                        v-model:checked="tree.createForm.isSideStory"
                        :disabled="true"
                        >番外章节</n-checkbox
                    >
                </n-form-item>
                <n-form-item label="大纲">
                    <n-input
                        v-model:value="tree.createForm.outline"
                        type="textarea"
                        placeholder="章节大纲"
                    />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="tree.showCreateModal = false"
                        >取消</n-button
                    >
                    <n-button type="primary" @click="handleCreateRoot"
                        >创建</n-button
                    >
                </n-space>
            </template>
        </n-modal>

        <!-- 发展 -->
        <n-modal
            v-model:show="tree.showDevelopModal"
            title="发展下一章"
            preset="card"
            style="width: 500px"
        >
            <n-form
                :model="tree.developForm"
                label-placement="left"
                label-width="80"
            >
                <n-form-item label="标题" required>
                    <n-input
                        v-model:value="tree.developForm.title"
                        placeholder="章节标题"
                    />
                </n-form-item>
                <n-form-item label="番外">
                    <n-checkbox
                        v-model:checked="tree.developForm.isSideStory"
                        :disabled="tree.developForceSideStory"
                    ></n-checkbox>
                    <n-text
                        v-if="tree.developForceSideStory"
                        depth="3"
                        style="font-size: 12px; margin-left: 8px"
                        >该章节已有后续章节或非最新章节，只能发展番外</n-text
                    >
                </n-form-item>
                <n-form-item label="大纲">
                    <n-input
                        v-model:value="tree.developForm.outline"
                        type="textarea"
                        placeholder="章节大纲"
                    />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="tree.showDevelopModal = false"
                        >取消</n-button
                    >
                    <n-button
                        type="primary"
                        @click="handleDevelop"
                        :disabled="!tree.developForm.title.trim()"
                        >创建</n-button
                    >
                </n-space>
            </template>
        </n-modal>

        <!-- 自定义候选 -->
        <n-modal
            v-model:show="drafts.showCustomModal"
            title="自定义候选生成"
            preset="card"
            style="width: 400px"
        >
            <n-form label-placement="left" label-width="100">
                <n-form-item label="Temperature">
                    <n-slider
                        v-model:value="drafts.customTemp"
                        :min="0"
                        :max="2"
                        :step="0.05"
                    />
                    <n-text>{{ drafts.customTemp.toFixed(2) }}</n-text>
                </n-form-item>
                <n-form-item label="Max Tokens">
                    <n-input-number
                        v-model:value="drafts.customMaxTokens"
                        :min="512"
                        :max="8192"
                        :step="256"
                    />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="drafts.showCustomModal = false"
                        >取消</n-button
                    >
                    <n-button
                        type="primary"
                        @click="handleGenerateCustom"
                        :loading="drafts.generating"
                        >生成</n-button
                    >
                </n-space>
            </template>
        </n-modal>

        <!-- 评分结果 -->
        <n-modal
            v-model:show="drafts.showScoreModal"
            title="评分结果"
            preset="card"
            style="width: 520px"
        >
            <n-space v-if="drafts.scoreResult" vertical size="large">
                <n-space
                    justify="center"
                    align="center"
                    vertical
                    style="padding: 8px 0"
                >
                    <n-text
                        style="
                            font-size: 48px;
                            font-weight: 700;
                            color: #1890ff;
                        "
                        >{{ drafts.scoreResult.totalScore }}</n-text
                    >
                </n-space>
                <n-divider />
                <n-space vertical size="small">
                    <n-space
                        v-for="(label, key) in scoreLabels"
                        :key="key"
                        justify="space-between"
                        align="center"
                    >
                        <n-text>{{ label }}</n-text>
                        <n-progress
                            :percentage="drafts.scoreResult[key]"
                            :show-indicator="false"
                            style="width: 200px"
                        />
                        <n-text strong>{{ drafts.scoreResult[key] }}</n-text>
                    </n-space>
                </n-space>
                <n-divider />
                <n-card
                    v-if="drafts.scoreResult.comment"
                    size="small"
                    :bordered="false"
                >
                    <n-text depth="3" style="font-size: 13px">{{
                        drafts.scoreResult.comment
                    }}</n-text>
                </n-card>
            </n-space>
            <n-empty v-else description="暂无评分数据" />
            <template #footer>
                <n-space justify="end">
                    <n-button @click="drafts.showScoreModal = false"
                        >关闭</n-button
                    >
                </n-space>
            </template>
        </n-modal>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useDebounceFn } from "@vueuse/core";
import {
    NH1,
    NSpace,
    NButton,
    NModal,
    NForm,
    NFormItem,
    NInput,
    NCard,
    NP,
    NTag,
    NEmpty,
    NGrid,
    NGridItem,
    NProgress,
    NText,
    NDivider,
    NIcon,
    NSelect,
    NSlider,
    NInputNumber,
    NSkeleton,
    NTabs,
    NTabPane,
    NScrollbar,
    NSpin,
    NCollapse,
    NCollapseItem,
    NCheckbox,
    NAlert,
    useDialog,
    useMessage,
} from "naive-ui";
import { ArrowBackOutline } from "@vicons/ionicons5";
import ChapterBranchTree from "../components/ChapterBranchTree.vue";
import ReviewingPanel from "./ReviewingPanel.vue";
import { chaptersApi } from "../api/chapters";
import { useChapterTree } from "../composables/useChapterTree";
import { useChapterEditor } from "../composables/useChapterEditor";
import { useDraftManager } from "../composables/useDraftManager";
import { usePromptManager } from "../composables/usePromptManager";

const route = useRoute();
const storyId = () => route.params.storyId as string | undefined;

// ========== Composables ==========
const tree = useChapterTree(storyId);
const editor = useChapterEditor(storyId);
const drafts = useDraftManager();
const prompt = usePromptManager(storyId);

// 防抖保存配置
const debouncedSaveConfig = useDebounceFn(editor.saveConfig, 500);

// 归档状态（放在页面层因为涉及跳转）
const archiving = ref(false);
// 重新准备归档的 loading 状态（reviewing → reviewing 重试路径）
const repreparingArchive = ref(false);
const isReadonly = computed(() => editor.currentChapter?.status === 'archived');
const dialog = useDialog();
const message = useMessage();
const reviewingPanelRef = ref<InstanceType<typeof ReviewingPanel> | null>(null);

// ========== 生命周期 ==========
onMounted(() => {
    prompt.loadDefaultModel();
    editor.loadProfiles();
    editor.loadModels();
    if (route.params.storyId) tree.loadChapterTree();
});

watch(
    () => route.params.storyId,
    () => {
        handleBackToTree();
        tree.loadChapterTree();
    },
);

// ========== 页面级协调函数 ==========
async function handleOpenEdit(row: any) {
    await editor.openEdit(row);
    await drafts.loadDrafts(row.id);
    prompt.loadFromChapter(row, drafts.drafts);
    // 自动预览
    if (!prompt.editablePrompt) {
        await prompt.generatePreview(row.id, editor.selectedProfileId);
    }
}

async function handleOpenView(row: any) {
    await editor.openEdit(row);
    // 只读模式不加载 drafts，不生成 prompt
    prompt.reset();
}

async function handleBackToTree() {
    drafts.stopPolling();
    prompt.reset();
    await editor.backToTree();
    await tree.loadChapterTree();
}

async function handleCreateRoot() {
    const data = await tree.handleCreateRoot();
    if (data) await handleOpenEdit(data);
}

async function handleDevelop() {
    const data = await tree.handleDevelop();
    if (data) await handleOpenEdit(data);
}

async function handleGeneratePrompt() {
    if (!editor.currentChapter) return;
    await prompt.generatePreview(
        editor.currentChapter.id,
        editor.selectedProfileId,
    );
}

async function handleGenerateDefault() {
    if (!editor.currentChapter || !storyId()) return;
    const result = await drafts.generate(
        editor.currentChapter.id,
        storyId()!,
        [0.6, 0.75, 0.9],
        editor.selectedProfileId,
    );
    if (result.success) {
        prompt.tokenStats = result.tokens;
        prompt.layerStats = result.layers;
    }
}

async function handleGenerateCustom() {
    if (!editor.currentChapter || !storyId()) return;
    await drafts.generate(
        editor.currentChapter.id,
        storyId()!,
        [drafts.customTemp],
        editor.selectedProfileId,
        drafts.customMaxTokens,
    );
    drafts.showCustomModal = false;
}

async function handleAdoptDraft(draft: any) {
    if (!draft.content || !editor.currentChapter) return;
    const doAdopt = async () => {
        const content = await drafts.selectDraft(editor.currentChapter!.id, draft.id);
        if (content !== null) {
            editor.editForm.content = content;
            editor.currentChapter!.content = content;
            editor.currentChapter!.status = 'selected';
        }
    };
    const currentContent = editor.editForm.content || '';
    if (currentContent.trim() && currentContent !== draft.content) {
        dialog.warning({
            title: '确认覆盖',
            content: '右侧正文已有内容，采用此版本将覆盖当前正文。是否继续？',
            positiveText: '覆盖',
            negativeText: '取消',
            positiveButtonProps: { type: 'primary' },
            onPositiveClick: doAdopt
        });
    } else {
        await doAdopt();
    }
}

function handlePrepareArchive() {
    if (!editor.currentChapter) return;
    const outline = editor.editForm.outline || '';
    const content = editor.editForm.content || '';
    if (!outline.trim()) {
        dialog.error({ title: '无法归档', content: '大纲不能为空' });
        return;
    }
    if (!content.trim()) {
        dialog.error({ title: '无法归档', content: '正文不能为空' });
        return;
    }
    if (content.length < outline.length) {
        dialog.error({ title: '无法归档', content: `正文长度（${content.length}）不能小于大纲长度（${outline.length}）` });
        return;
    }
    const d = dialog.warning({
        title: '准备归档',
        content: '即将进入归档审查，AI 会提取记忆、图谱、剧情弧线等信息供你确认。',
        positiveText: '开始审查',
        negativeText: '取消',
        positiveButtonProps: { type: 'primary' },
        onPositiveClick: () => {
            d.destroy();
            archiving.value = true;
            (async () => {
                try {
                    // 先保存正文，确保 reviewing 阶段的内容是最新的
                    await editor.saveContent();
                    const result = await editor.prepareArchive();
                    if (!result.success) {
                        message.error('进入归档审查失败');
                    }
                } catch (e: any) {
                    console.error('[handlePrepareArchive]', e);
                    message.error(e.message || '进入归档审查失败');
                } finally {
                    archiving.value = false;
                }
            })();
        }
    });
}

async function handleSavePendingArchiveData(data: any) {
    await editor.savePendingArchiveData(data);
}

async function handleConfirmArchive(data: any) {
    reviewingPanelRef.value?.startConfirm();
    try {
        const saveResult = await editor.savePendingArchiveData(data);
        if (!saveResult.success) return;
        const result = await editor.archiveChapter();
        if (result.success) await handleBackToTree();
    } finally {
        reviewingPanelRef.value?.stopConfirm();
    }
}

async function handleReprepareArchive() {
    // reviewing + pendingArchiveData=null 时的恢复路径：调用同一个
    // prepare-archive 端点（后端允许从 reviewing 重试），成功后
    // pendingArchiveData 被新 payload 填上，ReviewingPanel 自动渲染。
    // 失败时保持在 reviewing 状态 + 损坏的 pendingArchiveData，用户
    // 可以再点重试或选择"取消审查（删除本章）"。
    if (repreparingArchive.value) return;
    repreparingArchive.value = true;
    try {
        await editor.prepareArchive();
    } finally {
        repreparingArchive.value = false;
    }
}

function handleCancelReviewing() {
    // 取消审查：删除当前 reviewing 章节
    if (!editor.currentChapter) return;
    dialog.warning({
        title: '取消审查',
        content: '取消后将删除当前 reviewing 章节，是否继续？',
        positiveText: '删除',
        negativeText: '保留',
        positiveButtonProps: { type: 'error' },
        onPositiveClick: async () => {
            await chaptersApi.remove(editor.currentChapter!.id);
            await handleBackToTree();
        }
    });
}

// ========== 辅助常量 & 函数 ==========
const scoreLabels: Record<string, string> = {
    styleSimilarity: "文风接近度",
    outlineAdherence: "大纲符合度",
    sceneMatch: "场景符合度",
    profileConsistency: "写作人格一致性",
    proseQuality: "文笔质量",
    emotionalTension: "情感张力",
    pacing: "节奏把控",
};

function formatParams(p: string): any {
    try {
        return JSON.parse(p || "{}");
    } catch {
        return {};
    }
}

function statusTagType(status?: string) {
    switch (status) {
        case "archived":
            return "success";
        case "selected":
            return "info";
        case "reviewing":
            return "warning";
        case "generated":
            return "warning";
        case "generating":
            return "warning";
        case "scored":
            return "warning";
        case "rejected":
            return "error";
        case "draft":
            return "default";
        default:
            return "default";
    }
}

function arcStatusType(status?: string) {
    switch (status) {
        case "active":
            return "success";
        case "completed":
            return "default";
        case "resolving":
            return "warning";
        case "pending":
            return "default";
        default:
            return "default";
    }
}


</script>
