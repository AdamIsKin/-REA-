import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './styles.css'
import App from './App.vue'
import { router } from './router'
import { showError } from './api/errors'

const app = createApp(App)
app.use(createPinia())
app.use(router)
// 桌面程序没有首屏下载开销，整体注册 Element Plus 比按需引入少一套构建插件，维护更简单。
app.use(ElementPlus, { locale: zhCn })

// 兜底：未被页面捕获的业务错误统一弹出中文提示，避免“点了没反应”。
app.config.errorHandler = (err) => showError(err)
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  showError(e.reason)
})

app.mount('#app')
