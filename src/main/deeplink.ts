import { Notification } from 'electron'
import i18next from 'i18next'
import { addProfileItem } from './config'
import { mainWindow } from './window'
import { safeShowErrorBox } from './utils/init'

export async function handleDeepLink(url: string): Promise<void> {
  if (!url.startsWith('clash://') && !url.startsWith('mihomo://')) return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error(i18next.t('profiles.error.urlParamMissing'))
        }
        await addProfileItem({
          type: 'remote',
          name: profileName ?? undefined,
          url: profileUrl
        })
        mainWindow?.webContents.send('profileConfigUpdated')
        new Notification({ title: i18next.t('profiles.notification.importSuccess') }).show()
      } catch (e) {
        safeShowErrorBox('profiles.error.importFailed', `${url}\n${e}`)
      }
      break
    }
    case 'user-center-login': {
      const accessToken = urlObj.searchParams.get('access_token')
      const tokenType = urlObj.searchParams.get('token_type')
      const error = urlObj.searchParams.get('error')
      const state = urlObj.searchParams.get('state')
      mainWindow?.webContents.send('userCenterLogin', {
        accessToken: accessToken ?? undefined,
        tokenType: tokenType ?? undefined,
        error: error ?? undefined,
        state: state ?? undefined
      })
      break
    }
  }
}
