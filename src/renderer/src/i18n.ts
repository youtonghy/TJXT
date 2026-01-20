import { initReactI18next } from 'react-i18next'
import i18n, { initI18n } from '../../shared/i18n'
import { getAppConfig } from './utils/ipc'

// 初始化 React i18next
i18n.use(initReactI18next)

let initPromise: Promise<void> | null = null

export async function initRendererI18n(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const config = await getAppConfig()
      await initI18n({ lng: config.language })
    } catch (error) {
      // Fallback to default config to avoid untranslated/blank UI on startup.
      console.warn('[i18n] failed to load app config for language, fallback to default', error)
      await initI18n()
    }
  })()
  return initPromise
}

// 通知主进程语言变更
i18n.on('languageChanged', (lng) => {
  window.electron.ipcRenderer.invoke('changeLanguage', lng)
})

export default i18n
