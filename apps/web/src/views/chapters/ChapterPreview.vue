<template>
    <n-card
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
                @click="emit('generate-prompt')"
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
</template>

<script setup lang="ts">
import {
    NCard,
    NFormItem,
    NInput,
    NButton,
    NSpace,
    NText,
    NTag,
    NProgress,
} from "naive-ui";

defineProps<{
    prompt: any;
}>();

const emit = defineEmits<{
    (e: "generate-prompt"): void;
}>();
</script>