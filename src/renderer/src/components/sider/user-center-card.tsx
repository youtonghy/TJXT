import { Button, Card, CardBody, CardFooter, Progress, Tooltip } from '@heroui/react'
import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IoPersonOutline } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { calcPercent, calcTraffic } from '@renderer/utils/calc'
import dayjs from '@renderer/utils/dayjs'
import { createUserAuthUtils } from '@renderer/utils/user-auth'
import { API_USER_AGENT } from '@renderer/utils/api-service'

interface Props {
  iconOnly?: boolean
}

const UserCenterCard: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { userCenterCardStatus = 'col-span-2' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/user-center')
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'userCenter'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  const authUtils = useMemo(() => createUserAuthUtils(appConfig), [appConfig])
  const [traffic, setTraffic] = useState<{
    upload: number
    download: number
    total: number
    expire: number | null // seconds timestamp to align with profile card formatting
  } | null>(null)
  const [loggedIn, setLoggedIn] = useState<boolean>(authUtils.isLoggedIn())

  useEffect(() => {
    let aborted = false
    const fetchTraffic = async () => {
      try {
        // Only fetch in large mode and when logged in
        if (userCenterCardStatus !== 'col-span-2') return
        if (!authUtils.isLoggedIn()) {
          setLoggedIn(false)
          return
        }

        setLoggedIn(true)

        const token = authUtils.getToken()
        if (!token) return

        const apiBaseUrl = authUtils.getApiBaseUrl()
        const resp = await fetch(`${apiBaseUrl}/user/getSubscribe`, {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json',
            'User-Agent': API_USER_AGENT
          }
        })
        if (!resp.ok) return
        const data = await resp.json()
        const d = data?.data || data
        const u = Number(d?.u) || 0
        const dl = Number(d?.d) || 0
        const total = Number(d?.transfer_enable) || 0
        const expire = typeof d?.expired_at === 'number' ? d.expired_at : null // seconds
        if (!aborted) {
          setTraffic({ upload: u, download: dl, total, expire })
        }
      } catch {
        // ignore errors for sidebar card
      }
    }
    fetchTraffic()
    return () => {
      aborted = true
    }
  }, [authUtils, userCenterCardStatus, location.pathname])

  if (iconOnly) {
    return (
      <div className={`${userCenterCardStatus} flex justify-center`}>
        <Tooltip content={t('sider.cards.userCenter')} placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/user-center')
            }}
          >
            <IoPersonOutline className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }
  // Large layout (mimic Profiles card with traffic + expiry)
  if (userCenterCardStatus === 'col-span-2') {
    const usage = (traffic?.upload ?? 0) + (traffic?.download ?? 0)
    return (
      <div
        style={{
          position: 'relative',
          transform: CSS.Transform.toString(transform),
          transition,
          zIndex: isDragging ? 'calc(infinity)' : undefined
        }}
        className={`${userCenterCardStatus} user-center-card`}
      >
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? 'scale-[0.97] tap-highlight-transparent' : ''}`}
        >
          <CardBody className="pb-1">
            <div className="flex justify-between h-[32px]">
              <h3 className={`text-ellipsis whitespace-nowrap overflow-hidden text-md font-bold leading-[32px] ${match ? 'text-primary-foreground' : 'text-foreground'}`}>
                {t('sider.cards.userCenter')}
              </h3>
            </div>
            {traffic && (
              <div className={`mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'}`}>
                <small>{`${calcTraffic(usage)}/${calcTraffic(traffic.total)}`}</small>
                <Button
                  size="sm"
                  variant="light"
                  className={`h-[20px] p-1 m-0 ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                >
                  {traffic.expire ? dayjs.unix(traffic.expire).format('YYYY-MM-DD') : t('sider.cards.neverExpire')}
                </Button>
              </div>
            )}
            {!traffic && !loggedIn && (
              <div className={`mt-2 ${match ? 'text-primary-foreground' : 'text-default-500'}`}>
                <small>{t('support.loginRequired')}</small>
              </div>
            )}
          </CardBody>
          {traffic && (
            <CardFooter className="pt-0">
              <Progress
                className="w-full"
                aria-label={t('sider.cards.trafficUsage')}
                classNames={{ indicator: match ? 'bg-primary-foreground' : 'bg-foreground' }}
                value={calcPercent(traffic?.upload, traffic?.download, traffic?.total)}
              />
            </CardFooter>
          )}
        </Card>
      </div>
    )
  }

  // Small layout (icon + title)
  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${userCenterCardStatus} user-center-card`}
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
              <IoPersonOutline
                color="default"
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('sider.cards.userCenter')}
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default UserCenterCard
