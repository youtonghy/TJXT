/**
 * 页面：分流规则
 * Page: Rules
 */

// ======================== 导入区 ========================
// React 核心
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

// UI 组件
import { Divider, Input } from '@heroui/react'
import { Virtuoso } from 'react-virtuoso'

// 自定义组件
import BasePage from '@renderer/components/base/base-page'
import RuleItem from '@renderer/components/rules/rule-item'

// Hooks
import { useRules } from '@renderer/hooks/use-rules'

// 工具函数
import { includesIgnoreCase } from '@renderer/utils/includes'

const Rules: React.FC = () => {
  const { rules } = useRules()
  const [filter, setFilter] = useState('')
  const { t } = useTranslation()

  const filteredRules = useMemo(() => {
    if (!rules) return []
    if (filter === '') return rules.rules
    return rules.rules.filter((rule) => {
      return (
        includesIgnoreCase(rule.payload, filter) ||
        includesIgnoreCase(rule.type, filter) ||
        includesIgnoreCase(rule.proxy, filter)
      )
    })
  }, [rules, filter])

  // ======================== UI 渲染 ========================
  return (
    <BasePage title={t('rules.title')}>
      <div className="sticky top-0 z-40">
        <div className="flex p-2">
          <Input
            size="sm"
            value={filter}
            placeholder={t('rules.filter')}
            isClearable
            onValueChange={setFilter}
          />
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-[1px]">
        <Virtuoso
          data={filteredRules}
          itemContent={(i, rule) => (
            <RuleItem
              index={i}
              type={rule.type}
              payload={rule.payload}
              proxy={rule.proxy}
              size={rule.size}
            />
          )}
        />
      </div>
    </BasePage>
  )
}

export default Rules
