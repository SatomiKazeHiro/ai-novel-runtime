import { createRouter, createWebHistory } from 'vue-router'
import SimpleLayout from '../views/SimpleLayout.vue'
import NovelDesignLayout from '../views/NovelDesignLayout.vue'
import Dashboard from '../views/Dashboard.vue'
import Stories from '../views/Stories.vue'
import Characters from '../views/Characters.vue'
import LoreBook from '../views/LoreBook.vue'
import Timeline from '../views/Timeline.vue'
import Chapters from '../views/Chapters.vue'
import Graph from '../views/Graph.vue'
import Memory from '../views/Memory.vue'
import RuntimeProfile from '../views/RuntimeProfile.vue'
import WorkerTask from '../views/WorkerTask.vue'
import StoryWorkerTask from '../views/StoryWorkerTask.vue'
import ModelManager from '../views/ModelManager.vue'
import PromptLogs from '../views/PromptLogs.vue'
import ChapterReader from '../views/ChapterReader.vue'

const routes = [
  {
    path: '/',
    component: SimpleLayout,
    children: [
      { path: '', name: 'Dashboard', component: Dashboard },
      { path: 'stories', name: 'Stories', component: Stories },
      { path: 'runtime-profiles', name: 'RuntimeProfiles', component: RuntimeProfile },
      { path: 'worker-tasks', name: 'WorkerTasks', component: WorkerTask },
      { path: 'models', name: 'ModelManager', component: ModelManager }
    ]
  },
  {
    path: '/novel-design/:storyId',
    component: NovelDesignLayout,
    children: [
      { path: 'characters', name: 'Characters', component: Characters },
      { path: 'lore', name: 'LoreBook', component: LoreBook },
      { path: 'chapters', name: 'Chapters', component: Chapters },
      { path: 'reader', name: 'ChapterReader', component: ChapterReader },
      { path: 'graph', name: 'Graph', component: Graph },
      { path: 'memory', name: 'Memory', component: Memory },
      { path: 'timeline', name: 'Timeline', component: Timeline },
      { path: 'worker-tasks', name: 'StoryWorkerTasks', component: StoryWorkerTask },
      { path: 'prompt-logs', name: 'PromptLogs', component: PromptLogs }
    ]
  },
  // 旧路由重定向
  { path: '/characters', redirect: '/stories' },
  { path: '/lore', redirect: '/stories' },
  { path: '/chapters', redirect: '/stories' },
  { path: '/graph', redirect: '/stories' },
  { path: '/memory', redirect: '/stories' },
  { path: '/timeline', redirect: '/stories' },
  { path: '/runtime-profile', redirect: '/runtime-profiles' },
  { path: '/worker-task', redirect: '/worker-tasks' },
  // 旧 novel-design 无 storyId 路由重定向到小说管理
  { path: '/novel-design', redirect: '/stories' },
  { path: '/novel-design/:path(.*)', redirect: '/stories' }
]

export function setupRouter() {
  return createRouter({
    history: createWebHistory(),
    routes
  })
}
