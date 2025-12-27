/**
 * 页面：外部资源
 * Page: Resources
 */

// ======================== 导入区 ========================
// React 核心
import { useTranslation } from 'react-i18next'

// 自定义组件
import BasePage from '@renderer/components/base/base-page'
import GeoData from '@renderer/components/resources/geo-data'
import ProxyProvider from '@renderer/components/resources/proxy-provider'
import RuleProvider from '@renderer/components/resources/rule-provider'

// ======================== 组件主函数 ========================
const Resources: React.FC = () => {
  // -------- Hooks --------
  const { t } = useTranslation()

  // ======================== UI 渲染 ========================
  return (
    <BasePage title={t('sider.cards.resources')}>
      <GeoData />
      <ProxyProvider />
      <RuleProvider />
    </BasePage>
  )
}

export default Resources
