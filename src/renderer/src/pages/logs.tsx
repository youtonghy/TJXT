/**
 * 页面：实时日志
 * Page: Logs
 */

// ======================== 导入区 ========================
// React 核心
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// UI 组件
import { Button, Divider, Input } from '@heroui/react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

// 图标
import { IoLocationSharp } from 'react-icons/io5'
import { CgTrash } from 'react-icons/cg'

// 自定义组件
import BasePage from '@renderer/components/base/base-page'
import LogItem from '@renderer/components/logs/log-item'

// 工具函数
import { includesIgnoreCase } from '@renderer/utils/includes'

// ======================== 全局缓存 ========================
const cachedLogs: {
  log: IMihomoLogInfo[]
  trigger: ((i: IMihomoLogInfo[]) => void) | null
  clean: () => void
} = {
  log: [],
  trigger: null,
  clean(): void {
    this.log = []
    if (this.trigger !== null) {
      this.trigger(this.log)
    }
  }
}

// ======================== 事件监听 ========================
// 监听日志消息
window.electron.ipcRenderer.on('mihomoLogs', (_e, log: IMihomoLogInfo) => {
  log.time = new Date().toLocaleString()
  cachedLogs.log.push(log)
  if (cachedLogs.log.length >= 500) {
    cachedLogs.log.shift()
  }
  if (cachedLogs.trigger !== null) {
    cachedLogs.trigger(cachedLogs.log)
  }
})

// ======================== 组件主函数 ========================
const Logs: React.FC = () => {
  // -------- Hooks --------
  const { t } = useTranslation()

  // -------- 状态定义 --------
  const [logs, setLogs] = useState<IMihomoLogInfo[]>(cachedLogs.log)
  const [filter, setFilter] = useState('')
  const [trace, setTrace] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // -------- 计算属性 --------
  // 筛选日志列表
  const filteredLogs = useMemo(() => {
    if (filter === '') return logs
    return logs.filter((log) => {
      return includesIgnoreCase(log.payload, filter) || includesIgnoreCase(log.type, filter)
    })
  }, [logs, filter])

  useEffect(() => {
    if (!trace) return
    virtuosoRef.current?.scrollToIndex({
      index: filteredLogs.length - 1,
      behavior: 'smooth',
      align: 'end',
      offset: 0
    })
  }, [filteredLogs, trace])

  // -------- 副作用 --------
  // 设置日志更新回调
  useEffect(() => {
    const old = cachedLogs.trigger
    cachedLogs.trigger = (a): void => {
      setLogs([...a])
    }
    return (): void => {
      cachedLogs.trigger = old
    }
  }, [])

  // ======================== UI 渲染 ========================
  return (
    <BasePage title={t('logs.title')}>
      <div className="sticky top-0 z-40">
        <div className="w-full flex p-2">
          <Input
            size="sm"
            value={filter}
            placeholder={t('logs.filter')}
            isClearable
            onValueChange={setFilter}
          />
          <Button
            size="sm"
            isIconOnly
            className="ml-2"
            color={trace ? 'primary' : 'default'}
            variant={trace ? 'solid' : 'bordered'}
            title={t('logs.autoScroll')}
            onPress={() => {
              setTrace((prev) => !prev)
            }}
          >
            <IoLocationSharp className="text-lg" />
          </Button>
          <Button
            size="sm"
            isIconOnly
            title={t('logs.clear')}
            className="ml-2"
            variant="light"
            color="danger"
            onPress={() => {
              cachedLogs.clean()
            }}
          >
            <CgTrash className="text-lg" />
          </Button>
        </div>
        <Divider />
      </div>
      <div className="h-[calc(100vh-100px)] mt-[1px]">
        <Virtuoso
          ref={virtuosoRef}
          data={filteredLogs}
          itemContent={(i, log) => {
            return (
              <LogItem
                index={i}
                key={log.payload + i}
                time={log.time}
                type={log.type}
                payload={log.payload}
              />
            )
          }}
        />
      </div>
    </BasePage>
  )
}

export default Logs
