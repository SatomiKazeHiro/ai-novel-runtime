<template>
    <ChapterTree
        v-if="!editor.editMode"
        :tree-data="tree.chapterTree"
        :loading="tree.loading"
        :show-create-modal="tree.showCreateModal"
        :create-form="tree.createForm"
        :show-develop-modal="tree.showDevelopModal"
        :develop-form="tree.developForm"
        :develop-force-side-story="tree.developForceSideStory"
        @develop="tree.onDevelop"
        @edit="handleOpenEdit"
        @view="handleOpenView"
        @delete="tree.onDelete"
        @open-create-root="tree.openCreateRoot"
        @create-root="handleCreateRoot"
        @create-develop="handleDevelop"
        @close-create-modal="tree.showCreateModal = false"
        @close-develop-modal="tree.showDevelopModal = false"
    />
    <ChapterEditor
        v-else
        :chapter="editor.currentChapter"
        v-model:edit-title="editor.editTitle"
        v-model:edit-form="editor.editForm"
        v-model:selected-profile-id="editor.selectedProfileId"
        :profile-options="editor.profileOptions"
        v-model:selected-model-id="editor.selectedModelId"
        :model-options="editor.modelOptions"
        :plot-arcs="editor.plotArcs"
        :chapter-graph="editor.chapterGraph"
        :pending-archive-data="editor.pendingArchiveData"
        :saving-content="editor.savingContent"
        :archiving="archiving"
        :repreparing-archive="repreparingArchive"
        :prompt="prompt"
        :drafts="drafts"
        @back="handleBackToTree"
        @save-config="debouncedSaveConfig"
        @save-content="editor.saveContent"
        @generate-prompt="handleGeneratePrompt"
        @generate-default="handleGenerateDefault"
        @generate-custom="handleGenerateCustom"
        @adopt-draft="handleAdoptDraft"
        @prepare-archive="handlePrepareArchive"
        @confirm-archive="handleConfirmArchive"
        @prepare-archive-cancel="handlePrepareArchiveCancel"
        @update-stage="handleUpdateStage"
        @reprepare-archive="handleReprepareArchive"
        @cancel-reviewing="handleCancelReviewing"
    />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useDebounceFn } from "@vueuse/core";
import { useDialog, useMessage } from "naive-ui";
import { chaptersApi } from "../api/chapters";
import { useChapterTree } from "../composables/useChapterTree";
import { useChapterEditor } from "../composables/useChapterEditor";
import { useDraftManager } from "../composables/useDraftManager";
import { usePromptManager } from "../composables/usePromptManager";
import ChapterTree from "./chapters/ChapterTree.vue";
import ChapterEditor from "./chapters/ChapterEditor.vue";

const route = useRoute();
const storyId = () => route.params.storyId as string | undefined;

// ========== Composables ==========
const tree = useChapterTree(storyId);
const editor = useChapterEditor(storyId);
const drafts = useDraftManager();
const prompt = usePromptManager(storyId);

// 防抖保存配置
const debouncedSaveConfig = useDebounceFn(editor.saveConfig, 500);

// 归档状态(放在页面层因为涉及跳转)
const archiving = ref(false);
// 重新准备归档的 loading 状态(reviewing → reviewing 重试路径)
const repreparingArchive = ref(false);
const dialog = useDialog();
const message = useMessage();

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
    // 只读模式不加载 drafts,不生成 prompt
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

    // 仅在非草稿状态弹 token 成本确认对话框(已有候选,再生成属追加)
    // draft 状态是首次生成,直接放行(用户刚点进来,没有"追加"的成本顾虑)
    if (editor.currentChapter.status !== 'draft') {
        const existingCount = drafts.drafts.length;
        const newCount = 3;
        // 粗估:每候选 ~maxTokens × 1.3 (含 system prompt + 输出冗余)
        // drafts.customMaxTokens 来自自定义 modal,未设时 fallback 4096
        const estimatedTokens = newCount * (drafts.customMaxTokens || 4096) * 1.3;
        const ok = await new Promise<boolean>((resolve) => {
            dialog.warning({
                title: "生成新候选",
                content:
                    `当前已有 ${existingCount} 个候选,本次再生成 ${newCount} 个会追加到列表(旧候选保留)。\n\n` +
                    `预估消耗约 ${Math.round(estimatedTokens / 1000)}K tokens(取决于模型 max_tokens)。\n\n` +
                    `确认开始生成?`,
                positiveText: "确认生成",
                negativeText: "取消",
                onPositiveClick: () => resolve(true),
                onNegativeClick: () => resolve(false),
                onClose: () => resolve(false),
            });
        });
        if (!ok) return;
    }

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
    // v2: 覆盖确认已下沉到 drafts.selectDraft;chapter.status 不再被翻成 selected
    const content = await drafts.selectDraft(
        editor.currentChapter.id,
        draft.id,
        editor.editForm.content || "",
    );
    if (content !== null) {
        editor.editForm.content = content;
        editor.currentChapter!.content = content;
    }
}

function handlePrepareArchive() {
    if (!editor.currentChapter) return;
    const outline = editor.editForm.outline || "";
    const content = editor.editForm.content || "";
    if (!outline.trim()) {
        dialog.error({ title: "无法归档", content: "大纲不能为空" });
        return;
    }
    if (!content.trim()) {
        dialog.error({ title: "无法归档", content: "正文不能为空" });
        return;
    }
    if (content.length < outline.length) {
        dialog.error({
            title: "无法归档",
            content: `正文长度(${content.length})不能小于大纲长度(${outline.length})`,
        });
        return;
    }
    const d = dialog.warning({
        title: "准备归档",
        content: "即将进入归档审查,AI 会提取记忆、图谱、剧情弧线等信息供你确认。",
        positiveText: "开始审查",
        negativeText: "取消",
        positiveButtonProps: { type: "primary" },
        onPositiveClick: () => {
            d.destroy();
            archiving.value = true;
            (async () => {
                try {
                    // 先保存正文,确保 reviewing 阶段的内容是最新的
                    await editor.saveContent();
                    const result = await editor.prepareArchive();
                    if (!result.success) {
                        message.error("进入归档审查失败");
                    }
                } catch (e: any) {
                    console.error("[handlePrepareArchive]", e);
                    message.error(e.message || "进入归档审查失败");
                } finally {
                    archiving.value = false;
                }
            })();
        },
    });
}

async function handleConfirmArchive() {
    // v3: ReviewingPanel 只读,pendingArchiveData 在 prepareArchive 时已写入 DB。
    // archive 端点直接读 Chapter.pendingArchiveData 并 commit。
    const result = await editor.archiveChapter();
    if (result.success) await handleBackToTree();
}

async function handlePrepareArchiveCancel() {
    // v3: 撤销审查回退到 draft(不删章节)。弹窗确认避免误操作。
    if (!editor.currentChapter) return;
    const ok = await new Promise<boolean>((resolve) => {
        dialog.warning({
            title: "撤销审查",
            content: "撤销后将回到草稿状态,本次提取的记忆/图谱/弧线数据会清空(章节本身保留)。是否继续?",
            positiveText: "撤销",
            negativeText: "保留审查",
            positiveButtonProps: { type: "warning" },
            onPositiveClick: () => resolve(true),
            onNegativeClick: () => resolve(false),
            onClose: () => resolve(false),
        });
    });
    if (!ok) return;
    await editor.prepareArchiveCancel();
}

async function handleUpdateStage(stageName: string, result: unknown) {
    // v3 改造:用户在 ReviewingPanel 点行内 × 删除 AI 输出后,
    // 把改动深拷贝到 pendingArchiveData.stages[stageName].result 并静默持久化。
    // savePendingArchiveData 内部已用 1s 静默,不会每点 × 就 message 一次。
    if (!editor.pendingArchiveData) return
    const next = JSON.parse(JSON.stringify(editor.pendingArchiveData))
    if (!next.stages) next.stages = {}
    if (!next.stages[stageName]) {
        next.stages[stageName] = { status: 'success', result }
    } else {
        next.stages[stageName].result = result
    }
    await editor.savePendingArchiveData(next)
}

async function handleReprepareArchive() {
    // reviewing + pendingArchiveData=null 时的恢复路径:调用同一个
    // prepare-archive 端点(后端允许从 reviewing 重试),成功后
    // pendingArchiveData 被新 payload 填上,ReviewingPanel 自动渲染。
    if (repreparingArchive.value) return;
    // 仲裁 #3：后端 prepare-archive 重试会清空当前 pendingArchiveData
    // （用户对记忆/图谱/弧线的修订会被丢弃）。先弹窗告知，避免误操作。
    const ok = await new Promise<boolean>((resolve) => {
        dialog.warning({
            title: "重新准备归档",
            content:
                "重新准备归档会清空当前归档审查面板中的所有修改（记忆、图谱、剧情弧线等），并基于章节当前正文重新让 AI 提取。\n\n确认继续？",
            positiveText: "确认重新提取",
            negativeText: "取消",
            onPositiveClick: () => resolve(true),
            onNegativeClick: () => resolve(false),
            onClose: () => resolve(false),
        });
    });
    if (!ok) return;
    repreparingArchive.value = true;
    try {
        await editor.prepareArchive();
    } finally {
        repreparingArchive.value = false;
    }
}

function handleCancelReviewing() {
    // 取消审查:删除当前 reviewing 章节
    if (!editor.currentChapter) return;
    dialog.warning({
        title: "取消审查",
        content: "取消后将删除当前 reviewing 章节,是否继续?",
        positiveText: "删除",
        negativeText: "保留",
        positiveButtonProps: { type: "error" },
        onPositiveClick: async () => {
            await chaptersApi.remove(editor.currentChapter!.id);
            await handleBackToTree();
        },
    });
}
</script>