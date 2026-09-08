<template>
    <div>
        <!-- 顶部按钮 -->
        <n-space align="center" style="margin-bottom: 12px">
            <n-button
                v-if="chapter && chapter.status !== 'archived'"
                type="primary"
                size="small"
                @click="emit('generate-default')"
                :loading="drafts.generating"
                :disabled="drafts.generating"
            >
                <template v-if="drafts.generating">生成中...</template>
                <template v-else-if="chapter.status === 'draft'">默认候选 ×3</template>
                <template v-else>再生成 ×3</template>
            </n-button>
            <n-button
                size="small"
                @click="drafts.showCustomModal = true"
                :disabled="drafts.generating"
                >自定义 ×1</n-button
            >
            <n-text v-if="drafts.generating" depth="3" style="font-size: 12px">AI 创作中...</n-text>
        </n-space>

        <!-- 候选摘要 -->
        <n-space
            v-if="drafts.drafts.length > 0"
            align="center"
            style="margin-bottom: 8px"
        >
            <n-text depth="3" style="font-size: 12px">
                共 {{ drafts.drafts.length }} 个候选
                <template v-if="drafts.drafts.some((d: any) => d.status === 'selected')">
                    ,已选 1 个(右上角带 ✓)
                </template>
            </n-text>
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
                :tab="draft.status === 'selected' ? `${draft.version} ✓` : draft.version"
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
                            <n-p style="white-space: pre-wrap; font-size: 12px; color: var(--color-text-caption);">
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
                            @click="emit('adopt-draft', draft)"
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

        <!-- ========== 弹窗:自定义候选 ========== -->
        <n-modal
            :show="drafts.showCustomModal"
            title="自定义候选生成"
            preset="card"
            style="width: 400px"
            @update:show="(v: boolean) => !v && (drafts.showCustomModal = false)"
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
                        @click="emit('generate-custom')"
                        :loading="drafts.generating"
                        >生成</n-button
                    >
                </n-space>
            </template>
        </n-modal>

        <!-- ========== 弹窗:评分结果 ========== -->
        <n-modal
            :show="drafts.showScoreModal"
            title="评分结果"
            preset="card"
            style="width: 520px"
            @update:show="(v: boolean) => !v && (drafts.showScoreModal = false)"
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
                            color: var(--color-cool-accent);
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
import {
    NTabs,
    NTabPane,
    NSpace,
    NButton,
    NText,
    NDivider,
    NScrollbar,
    NSpin,
    NP,
    NEmpty,
    NModal,
    NForm,
    NFormItem,
    NSlider,
    NInputNumber,
    NProgress,
    NCard,
} from "naive-ui";

defineProps<{
    drafts: any;
    chapter: any;
    prompt: any;
}>();

const emit = defineEmits<{
    (e: "generate-default"): void;
    (e: "generate-custom"): void;
    (e: "adopt-draft", draft: any): void;
}>();

// 7 维度评分标签(从原 Chapters.vue 搬到此处)
const scoreLabels: Record<string, string> = {
    styleSimilarity: "文风接近度",
    outlineAdherence: "大纲符合度",
    sceneMatch: "场景符合度",
    profileConsistency: "写作人格一致性",
    proseQuality: "文笔质量",
    emotionalTension: "情感张力",
    pacing: "节奏把控",
};

// 解析 draft.params(JSON 字符串 → 对象),兜底空对象
function formatParams(p: string): any {
    try {
        return JSON.parse(p || "{}");
    } catch {
        return {};
    }
}
</script>