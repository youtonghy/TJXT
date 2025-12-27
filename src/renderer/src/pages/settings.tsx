/**
 * 页面：应用设置
 * Page: Settings
 */

// ======================== 导入区 ========================
// React 核心
import { useTranslation } from 'react-i18next'

// 自定义组件
import BasePage from '@renderer/components/base/base-page'
import WebdavConfig from '@renderer/components/settings/webdav-config'
import GeneralConfig from '@renderer/components/settings/general-config'
import MihomoConfig from '@renderer/components/settings/mihomo-config'
import Actions from '@renderer/components/settings/actions'
import ShortcutConfig from '@renderer/components/settings/shortcut-config'
import SiderConfig from '@renderer/components/settings/sider-config'
import SubStoreConfig from '@renderer/components/settings/substore-config'

// ======================== 组件主函数 ========================
const Settings: React.FC = () => {
  // -------- Hooks --------
  const { t } = useTranslation()

  // ======================== UI 渲染 ========================
  return (
    <BasePage
      title={t('settings.title')}
      header={<></>}
    >
      <GeneralConfig />
      <SubStoreConfig />
      <SiderConfig />
      <WebdavConfig />
      <MihomoConfig />
      <ShortcutConfig />
      <Actions />
    </BasePage>
  )
}

export default Settings
