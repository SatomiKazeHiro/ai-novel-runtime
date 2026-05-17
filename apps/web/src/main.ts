import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { setupRouter } from './router'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(setupRouter())
app.mount('#app')
