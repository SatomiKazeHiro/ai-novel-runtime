<template>
    <div>
        <!-- ========== 顶部导航 ========== -->
        <n-space align="center" style="margin-bottom: 24px">
            <n-button @click="emit('back')">
                <template #icon
                    ><n-icon><ArrowBackOutline /></n-icon
                ></template>
                返回
            </n-button>
            <n-divider vertical />
            <n-input
                v-model:value="editTitle"
                style="width: 320px; font-size: 16px; font-weight: 600"
                placeholder="章节标题"
            />
            <n-tag
                v-if="chapter?.isSideStory"
                size="small"
                type="warning"
                >番外</n-tag
            >
            <n-tag
                size="small"
                :type="statusTagType(chapter?.status)"
                >{{ chapter?.status }}</n-tag
            >
            <n-tag v-if="isReadonly" size="small" type="info">只读</n-tag>
        </n-space>

        <!-- ========== Step 1: 配置区 ========== -->
        <n-card title="Step 1：配置区" style="margin-bottom: 24px">
            <n-grid :cols="3" :x-gap="12">
                <n-grid-item>
                    <n-form-item
                        label="写作人格"
                        label-placement="left"
                        label-width="80"
                    >
                        <n-select
                            v-model:value="selectedProfileId"
                            :options="profileOptions"
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
                            v-model:value="selectedModelId"
                            :options="modelOptions"
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
                    v-if="plotArcs.length > 0"
                >
                    <n-grid :cols="3" :x-gap="12" :y-gap="12">
                        <n-grid-item
                            v-for="arc in plotArcs"
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
                        v-model:value="editForm.outline"
                        type="textarea"
                        :rows="12"
                        placeholder="输入章节大纲..."
                        :readonly="isReadonly"
                    />
                </n-form-item>
                <n-text
                    v-if="editForm.outline"
                    style="padding-left: 80px; --n-text-color: rgb(118, 124, 130)"
                >
                        总字数：{{ editForm.outline.length }}字
                </n-text>

                <n-divider />

                <n-grid :cols="3" :x-gap="16">
                    <n-grid-item>
                        <n-form-item label="地点"
                            ><n-input
                                v-model:value="
                                    editForm.sceneLocation
                                "
                                placeholder="场景地点，如：青云宗藏书阁地下三层"
                                :readonly="isReadonly"
                        /></n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item label="氛围"
                            ><n-input
                                v-model:value="editForm.sceneMood"
                                placeholder="氛围，如：紧张、压抑、随时可能被发现"
                                :readonly="isReadonly"
                        /></n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item label="目标"
                            ><n-input
                                v-model:value="editForm.sceneGoal"
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
                    @click="emit('save-config')"
                    size="small"
                    >保存配置</n-button
                >
            </template>
        </n-card>

        <!-- ========== Step 2: Prompt (嵌入 ChapterPreview) ========== -->
        <ChapterPreview
            v-if="!isReadonly"
            :prompt="prompt"
            @generate-prompt="emit('generate-prompt')"
        />

        <!-- ========== Step 3: 正文编辑 (外壳 + 嵌入 DraftList) ========== -->
        <n-card
            title="Step 3：正文编辑"
            v-if="!isReadonly"
            style="margin-bottom: 24px"
        >
            <n-grid :cols="2" :x-gap="16" style="min-height: 480px">
                <!-- 左侧:候选生成区(嵌入 DraftList) -->
                <n-grid-item>
                    <DraftList
                        :drafts="drafts"
                        :chapter="chapter"
                        :prompt="prompt"
                        @generate-default="emit('generate-default')"
                        @generate-custom="emit('generate-custom')"
                        @adopt-draft="(d: any) => emit('adopt-draft', d)"
                    />
                </n-grid-item>

                <!-- 右侧:正文编辑区 -->
                <n-grid-item>
                    <n-input
                        v-model:value="editForm.content"
                        type="textarea"
                        :rows="22"
                        placeholder="在这里粘贴或编辑章节正文..."
                    />
                    <n-space align="center" justify="space-between" style="margin-top: 12px">
                        <n-space>
                            <n-button v-if="chapter?.status !== 'archived'" type="primary" size="small" @click="emit('save-content')" :loading="savingContent" :disabled="savingContent">保存正文</n-button>
                            <n-button v-if="chapter?.status === 'draft'" size="small" @click="emit('prepare-archive')" :loading="archiving">准备归档</n-button>
                        </n-space>
                        <n-text depth="3" style="font-size: 13px">
                            {{ (editForm.content || "").length.toLocaleString() }} 字
                        </n-text>
                    </n-space>
                </n-grid-item>
            </n-grid>
        </n-card>

        <!-- ========== Step 3.5: 归档审查 (嵌入 ReviewingPanel) ========== -->
        <ReviewingPanel
            v-if="chapter?.status === 'reviewing' && pendingArchiveData"
            ref="reviewingPanelRef"
            :chapter="chapter"
            :pending-archive-data="pendingArchiveData"
            @save="(data: any) => emit('save-pending-archive', data)"
            @confirm="(data: any) => emit('confirm-archive', data)"
            @cancel="emit('cancel-reviewing')"
        />

        <!-- reviewing 但无待归档数据:提示异常 -->
        <n-card
            v-else-if="chapter?.status === 'reviewing'"
            title="归档审查"
            style="margin-bottom: 24px">
            <n-space vertical>
                <n-alert type="error" :show-icon="false">
                    未能加载归档审查数据。可能是准备归档时提取失败，或数据解析异常。
                </n-alert>
                <n-space>
                    <n-button
                        type="warning"
                        size="small"
                        :loading="repreparingArchive"
                        @click="emit('reprepare-archive')"
                    >重新准备归档</n-button>
                    <n-button type="error" size="small" @click="emit('cancel-reviewing')">取消审查（删除本章）</n-button>
                </n-space>
            </n-space>
        </n-card>

        <!-- ========== Step 3 只读:正文展示 ========== -->
        <n-card
            v-if="isReadonly"
            title="Step 3：正文"
            style="margin-bottom: 24px"
        >
            <n-input
                v-model:value="editForm.content"
                type="textarea"
                :rows="20"
                readonly
                style="margin-bottom: 12px"
            />
            <n-text depth="3" style="font-size: 13px">
                总字数：{{
                    (editForm.content || "").length.toLocaleString()
                }}
                字
            </n-text>
        </n-card>

        <!-- ========== Step 4: 本章范围图谱 ========== -->
        <n-card
            v-if="
                chapter?.status === 'archived' &&
                graphDelta
            "
            title="Step 4：本章范围图谱"
            style="margin-top: 24px"
        >
            <n-space vertical>
                <n-collapse v-if="graphDelta.nodes?.length > 0">
                    <n-collapse-item title="涉及节点">
                        <n-space>
                            <n-tag
                                v-for="node in graphDelta.nodes"
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
                <n-collapse v-if="graphDelta.edges?.length > 0">
                    <n-collapse-item title="关系">
                        <n-space vertical size="small">
                            <n-text
                                v-for="edge in graphDelta.edges"
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
                        !graphDelta.nodes?.length &&
                        !graphDelta.edges?.length
                    "
                    description="本章未提取到图谱关系"
                />
            </n-space>
        </n-card>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
    NSpace,
    NButton,
    NDivider,
    NIcon,
    NCard,
    NGrid,
    NGridItem,
    NForm,
    NFormItem,
    NInput,
    NSelect,
    NTag,
    NText,
    NProgress,
    NAlert,
    NCollapse,
    NCollapseItem,
    NEmpty,
} from "naive-ui";
import { ArrowBackOutline } from "@vicons/ionicons5";
import ReviewingPanel from "../ReviewingPanel.vue";
import ChapterPreview from "./ChapterPreview.vue";
import DraftList from "./DraftList.vue";

// Vue 3.4+ defineModel:把 prop 声明为可写的 model,
// 模板 v-model 会自动生成 :value + @update:value,父组件用 v-model="editor.editTitle" 即可双向同步。
// 这样既保留 spec §3.2 的 17 prop 字段命名,又解决 v-model-on-prop 的编译限制。
const props = defineProps<{
    chapter: any;
    editTitle: string;
    editForm: {
        outline: string;
        content: string;
        sceneLocation: string;
        sceneMood: string;
        sceneGoal: string;
    };
    selectedProfileId: string | null;
    profileOptions: any[];
    selectedModelId: string | null;
    modelOptions: any[];
    plotArcs: any[];
    graphDelta: any;
    pendingArchiveData: any;
    savingContent: boolean;
    isReadonly: boolean;
    archiving: boolean;
    repreparingArchive: boolean;
    prompt: any;
    drafts: any;
}>();

// 父组件用 v-model:edit-title="editor.editTitle" 双向绑,内部 v-model 也直接生效
const editTitle = defineModel<string>("editTitle", { required: true });
const editForm = defineModel<{
    outline: string;
    content: string;
    sceneLocation: string;
    sceneMood: string;
    sceneGoal: string;
}>("editForm", { required: true });
const selectedProfileId = defineModel<string | null>("selectedProfileId", {
    required: true,
});
const selectedModelId = defineModel<string | null>("selectedModelId", {
    required: true,
});

// 确保 props 被引用,避免 TS noUnusedParameters 警告
void props;

const emit = defineEmits<{
    (e: "back"): void;
    (e: "save-config"): void;
    (e: "save-content"): void;
    (e: "generate-prompt"): void;
    (e: "generate-default"): void;
    (e: "generate-custom"): void;
    (e: "adopt-draft", draft: any): void;
    (e: "prepare-archive"): void;
    (e: "save-pending-archive", data: any): void;
    (e: "confirm-archive", data: any): void;
    (e: "reprepare-archive"): void;
    (e: "cancel-reviewing"): void;
}>();

// ReviewingPanel ref(子组件内部持有,view shell 通过 chapterEditorRef.startConfirm / stopConfirm 间接调用)
const reviewingPanelRef = ref<InstanceType<typeof ReviewingPanel> | null>(null);

function startConfirm() {
    reviewingPanelRef.value?.startConfirm();
}

function stopConfirm() {
    reviewingPanelRef.value?.stopConfirm();
}

defineExpose({ startConfirm, stopConfirm });

// 章节 status → n-tag type 映射 (v2 3 态: draft / reviewing / archived)
function statusTagType(status?: string) {
    switch (status) {
        case "archived":
            return "success";
        case "reviewing":
            return "warning";
        case "draft":
            return "default";
        default:
            return "default";
    }
}

// 剧情弧线 status → n-tag type 映射 (5 态 2026-06-27: active / resolving / completed / closed / stale)
function arcStatusType(status?: string) {
    switch (status) {
        case "active":
            return "success";
        case "resolving":
            return "warning";
        case "completed":
            return "default";
        case "closed":
            return "warning"; // 橙色, 提示"被合并/关闭"
        case "stale":
            return "info"; // 蓝色, 提示"沉寂中"
        default:
            return "default";
    }
}
</script>