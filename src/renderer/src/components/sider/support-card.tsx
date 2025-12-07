import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IoHelpCircleOutline } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { createUserAuthUtils } from '@renderer/utils/user-auth'
import { useTranslation } from 'react-i18next'

interface Props {
  iconOnly?: boolean
}

const SupportCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { supportCardStatus = 'col-span-1' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/support')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'support'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  const goSupport = (): void => {
    const auth = createUserAuthUtils(appConfig)
    if (!auth.isLoggedIn()) {
      try {
        // @ts-ignore Notification exists in Electron renderer
        new Notification('请先登录')
      } catch {}
      navigate('/user-center')
      return
    }
    navigate('/support')
  }

  if (iconOnly) {
    return (
      <div className={`${supportCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.support')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={goSupport}
          >
            <IoHelpCircleOutline className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${supportCardStatus} support-card`}
    >
      <Card
        fullWidth
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? 'scale-[0.97] tap-highlight-transparent' : ''}`}
      >
        <CardBody className="pb-1 pt-0 px-0">
          <div className="flex justify-between">
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <IoHelpCircleOutline
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.support')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SupportCard
