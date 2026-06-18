<template>
    <div>
        <!-- 章节工作台标题 + 新建根章节按钮 -->
        <n-space
            justify="space-between"
            align="center"
            style="margin-bottom: 16px"
        >
            <n-h1>章节工作台</n-h1>
            <n-button
                v-if="treeData.length === 0"
                type="primary"
                @click="emit('open-create-root')"
                >新建根章节</n-button
            >
        </n-space>

        <!-- loading skeleton -->
        <n-card v-if="loading" size="small">
            <n-skeleton text :repeat="3" />
        </n-card>

        <!-- 空状态 -->
        <n-empty
            v-else-if="treeData.length === 0"
            description="暂无章节，点击新建根章节开始创作"
        />

        <!-- 嵌入现有 ChapterBranchTree 组件(emit 转发) -->
        <ChapterBranchTree
            v-else
            :tree-data="treeData"
            :selected-id="selectedId"
            @select="(node: any) => emit('select', node)"
            @develop="(node: any) => emit('develop', node)"
            @edit="(node: any) => emit('edit', node)"
            @view="(node: any) => emit('view', node)"
            @delete="(node: any) => emit('delete', node)"
        />

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
import {
    NH1,
    NSpace,
    NButton,
    NModal,
    NForm,
    NFormItem,
    NInput,
    NCard,
    NEmpty,
    NSkeleton,
    NCheckbox,
    NText,
} from "naive-ui";
import ChapterBranchTree from "../../components/ChapterBranchTree.vue";

defineProps<{
    treeData: any[];
    loading: boolean;
    selectedId: string;
    showCreateModal: boolean;
    createForm: { title: string; outline: string; isSideStory: boolean };
    showDevelopModal: boolean;
    developForm: { title: string; outline: string; isSideStory: boolean };
    developForceSideStory: boolean;
}>();

const emit = defineEmits<{
    (e: "select", node: any): void;
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
</script>