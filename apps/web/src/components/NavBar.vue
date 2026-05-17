<template>
  <n-layout-header
    bordered
    style="padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;"
  >
    <!-- 左侧：标题 + 主要导航 -->
    <n-space align="center" :size="24">
      <n-text strong style="font-size: 18px;">AI Novel Runtime</n-text>
      <n-space :size="4">
        <n-button
          text
          :type="route.name === 'Dashboard' ? 'primary' : 'default'"
          @click="router.push('/')"
        >
          仪表盘
        </n-button>
        <n-button
          text
          :type="route.name === 'Stories' ? 'primary' : 'default'"
          @click="router.push('/stories')"
        >
          小说管理
        </n-button>
        <n-button
          text
          :type="route.name === 'RuntimeProfiles' ? 'primary' : 'default'"
          @click="router.push('/runtime-profiles')"
        >
          写作人格
        </n-button>
        <n-button
          text
          :type="route.name === 'WorkerTasks' ? 'primary' : 'default'"
          @click="router.push('/worker-tasks')"
        >
          Worker Task
        </n-button>
      </n-space>
    </n-space>

    <!-- 右侧：设置 -->
    <n-space align="center" :size="12">
      <n-button text @click="showSettings = true">
        <template #icon><n-icon><SettingsOutline /></n-icon></template>
      </n-button>
    </n-space>

    <!-- 设置弹窗 -->
    <n-modal v-model:show="showSettings" title="设置" preset="card" style="width: 480px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="主题">
          <n-radio-group v-model:value="themeStore.mode" @update:value="themeStore.setMode">
            <n-radio-button value="light">白天</n-radio-button>
            <n-radio-button value="dark">黑暗</n-radio-button>
            <n-radio-button value="system">系统</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="关于">
          <n-text>AI Novel Runtime v0.1.0</n-text>
        </n-form-item>
      </n-form>
    </n-modal>
  </n-layout-header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayoutHeader, NButton, NIcon, NSpace, NText,
  NModal, NForm, NFormItem, NRadioGroup, NRadioButton
} from 'naive-ui'
import { SettingsOutline } from '@vicons/ionicons5'
import { useThemeStore } from '../stores/theme'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const showSettings = ref(false)
</script>
