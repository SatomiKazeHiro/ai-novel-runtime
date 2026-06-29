import { createRouter, createWebHistory } from 'vue-router'
import SimpleLayout from '../views/SimpleLayout.vue'
import NovelDesignLayout from '../views/NovelDesignLayout.vue'
import NovelDesignV2Layout from '../views-v2/NovelDesignV2Layout.vue'
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
import V2Characters from '../views-v2/V2Characters.vue'
import V2CharacterDetail from '../views-v2/V2CharacterDetail.vue'
import V2LoreBook from '../views-v2/V2LoreBook.vue'
import V2Chapters from '../views-v2/V2Chapters.vue'
import V2ChapterDesign from '../views-v2/V2ChapterDesign.vue'
import V2ChapterReader from '../views-v2/V2ChapterReader.vue'
import V2PlotArcs from '../views-v2/V2PlotArcs.vue'
import V2Memory from '../views-v2/V2Memory.vue'
import V2Graph from '../views-v2/V2Graph.vue'
import V2Timeline from '../views-v2/V2Timeline.vue'
import V2StoryWorkerTask from '../views-v2/V2StoryWorkerTask.vue'
import V2PromptLogs from '../views-v2/V2PromptLogs.vue'

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
  {
    path: '/novel-design-v2/:storyId',
    component: NovelDesignV2Layout,
    children: [
      { path: 'characters',   name: 'V2Characters',      component: V2Characters },
      { path: 'characters/:charId', name: 'V2CharacterDetail', component: V2CharacterDetail },
      { path: 'lore',         name: 'V2LoreBook',        component: V2LoreBook },
      { path: 'chapters',     name: 'V2Chapters',        component: V2Chapters },
      { path: 'chapters/:chapterId/design', name: 'V2ChapterDesign', component: V2ChapterDesign },
      { path: 'reader',       name: 'V2ChapterReader',   component: V2ChapterReader },
      { path: 'plot-arcs',    name: 'V2PlotArcs',        component: V2PlotArcs },
      { path: 'memory',       name: 'V2Memory',          component: V2Memory },
      { path: 'graph',        name: 'V2Graph',           component: V2Graph },
      { path: 'timeline',     name: 'V2Timeline',        component: V2Timeline },
      { path: 'worker-tasks', name: 'V2StoryWorkerTasks', component: V2StoryWorkerTask },
      { path: 'prompt-logs',  name: 'V2PromptLogs',      component: V2PromptLogs }
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
