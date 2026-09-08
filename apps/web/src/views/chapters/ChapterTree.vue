<template>
    <div>
        <!-- 章节工作台标题 + 新建根章节按钮 -->
        <header class="page-head">
            <div class="page-head__text">
                <span class="cap-eyebrow">CHAPTER WORKBENCH</span>
                <h1 class="page-head__title">章节工作台</h1>
                <p class="page-head__lede cap-body-sm">主线章节严格线性（1, 2, 3…），番外可从任意归档章节分支（1.01, 1.02）。</p>
            </div>
            <div class="page-head__actions">
                <button
                    v-if="treeData.length === 0"
                    class="cap-pill is-primary"
                    @click="emit('open-create-root')"
                >+ 新建根章节</button>
            </div>
        </header>

        <!-- loading skeleton -->
        <div v-if="loading" class="cap-card">
            <n-skeleton text :repeat="3" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="treeData.length === 0" class="cap-card cap-empty">
            <svg class="cap-empty__mark" viewBox="0 0 48 48" width="48" height="48" fill="none" aria-hidden="true">
                <rect width="48" height="48" rx="6" fill="var(--accent-info-tint)" stroke="var(--accent-link)" stroke-opacity="0.4"/>
                <path d="M14 16 L24 24 L14 32" stroke="var(--accent-link)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="30" y="30" width="4" height="4" rx="0.8" fill="var(--accent)"/>
            </svg>
            <h3 class="cap-subheading" style="margin: 0">还没有章节</h3>
            <p class="cap-body-sm cap-muted" style="margin: 4px 0 16px">从根章节开始你的故事</p>
            <button class="cap-pill is-primary" @click="emit('open-create-root')">+ 新建根章节</button>
        </div>

        <!-- 嵌入现有 ChapterBranchTree 组件(emit 转发) -->
        <div v-else class="cap-card branch-card">
            <div class="branch-card__header">
                <span class="cap-eyebrow">TIMELINE</span>
                <span class="branch-card__divider" />
                <span class="branch-card__stat">{{ treeData.length }} ROOT · {{ chapterStats.total }} CHAPTERS</span>
                <span v-if="chapterStats.branches > 0" class="branch-card__stat branch-card__stat--branch">+ {{ chapterStats.branches }} BRANCH</span>
            </div>
            <ChapterBranchTree
                :tree-data="treeData"
                @develop="(node: any) => emit('develop', node)"
                @edit="(node: any) => emit('edit', node)"
                @view="(node: any) => emit('view', node)"
                @delete="(node: any) => emit('delete', node)"
            />
        </div>

        <!-- ========== 弹窗:新建根章节 ========== -->
        <n-modal
            :show="showCreateModal"
            title="新建根章节"
            preset="card"
            style="width: 500px"
            @update:show="(v: boolean) => !v && emit('close-create-modal')"
        >
            <n-form
                :model="createForm"
                label-placement="left"
                label-width="80"
            >
                <n-form-item label="标题" required>
                    <n-input
                        v-model:value="createForm.title"
                        placeholder="章节标题"
                    />
                </n-form-item>
                <n-form-item v-if="treeData.length > 0">
                    <n-checkbox
                        v-model:checked="createForm.isSideStory"
                        :disabled="true"
                        >番外章节</n-checkbox
                    >
                </n-form-item>
                <n-form-item label="大纲">
                    <n-input
                        v-model:value="createForm.outline"
                        type="textarea"
                        placeholder="章节大纲"
                    />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="emit('close-create-modal')"
                        >取消</n-button
                    >
                    <n-button type="primary" @click="emit('create-root')"
                        >创建</n-button
                    >
                </n-space>
            </template>
        </n-modal>

        <!-- ========== 弹窗:发展下一章 ========== -->
        <n-modal
            :show="showDevelopModal"
            title="发展下一章"
            preset="card"
            style="width: 500px"
            @update:show="(v: boolean) => !v && emit('close-develop-modal')"
        >
            <n-form
                :model="developForm"
                label-placement="left"
                label-width="80"
            >
                <n-form-item label="标题" required>
                    <n-input
                        v-model:value="developForm.title"
                        placeholder="章节标题"
                    />
                </n-form-item>
                <n-form-item label="番外">
                    <n-checkbox
                        v-model:checked="developForm.isSideStory"
                        :disabled="developForceSideStory"
                    ></n-checkbox>
                    <n-text
                        v-if="developForceSideStory"
                        depth="3"
                        style="font-size: 12px; margin-left: 8px"
                        >该章节已有后续章节或非最新章节，只能发展番外</n-text
                    >
                </n-form-item>
                <n-form-item label="大纲">
                    <n-input
                        v-model:value="developForm.outline"
                        type="textarea"
                        placeholder="章节大纲"
                    />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="emit('close-develop-modal')"
                        >取消</n-button
                    >
                    <n-button
                        type="primary"
                        @click="emit('create-develop')"
                        :disabled="!developForm.title.trim()"
                        >创建</n-button
                    >
                </n-space>
            </template>
        </n-modal>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
    NSpace,
    NButton,
    NModal,
    NForm,
    NFormItem,
    NInput,
    NSkeleton,
    NCheckbox,
    NText,
} from "naive-ui";
import ChapterBranchTree from "../../components/ChapterBranchTree.vue";

const props = defineProps<{
    treeData: any[];
    loading: boolean;
    showCreateModal: boolean;
    createForm: { title: string; outline: string; isSideStory: boolean };
    showDevelopModal: boolean;
    developForm: { title: string; outline: string; isSideStory: boolean };
    developForceSideStory: boolean;
}>();

const emit = defineEmits<{
    (e: "develop", node: any): void;
    (e: "edit", node: any): void;
    (e: "view", node: any): void;
    (e: "delete", node: any): void;
    (e: "open-create-root"): void;
    (e: "create-root"): void;
    (e: "create-develop"): void;
    (e: "close-create-modal"): void;
    (e: "close-develop-modal"): void;
}>();

void props; // referenced by chapterStats

const chapterStats = computed(() => {
    let total = 0;
    let branches = 0;
    function walk(nodes: any[]) {
        for (const n of nodes) {
            total += 1;
            if (n.isSideStory) branches += 1;
            if (n.children?.length) walk(n.children);
        }
    }
    walk(props.treeData);
    return { total, branches };
});
</script>

<style scoped>
.cap-empty {
  text-align: center;
  padding: 72px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.cap-empty__mark {
  margin-bottom: 12px;
}

/* === Branch card container === */
.branch-card {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.branch-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-default);
}
.branch-card__divider {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border-default), transparent);
}
.branch-card__stat {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.branch-card__stat--branch {
  color: var(--accent);
}
</style>