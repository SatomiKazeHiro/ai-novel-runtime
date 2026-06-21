import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { setupRouter } from './router'
import App from './App.vue'

import './styles/tokens.css'
import './styles/base.css'

const app = createApp(App)
app.use(createPinia())
app.use(setupRouter())
app.mount('#app')
