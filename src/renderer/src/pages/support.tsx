import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BasePage from '@renderer/components/base/base-page'
import { useTranslation } from 'react-i18next'
import { Button, Card, CardBody, CardHeader, Divider, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner, Textarea, Chip } from '@heroui/react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { createUserAuthUtils } from '@renderer/utils/user-auth'
import { getActiveBackendApiBaseUrl } from '@renderer/utils/user-center-backend'
import { API_USER_AGENT } from '@renderer/utils/api-service'
import dayjs from '@renderer/utils/dayjs'
import { useNavigate } from 'react-router-dom'
import { readLatestLogTail } from '@renderer/utils/ipc'

interface TicketItem {
  id: number
  user_id: number
  subject: string
  level: number
  status: number
  reply_status: number
  created_at: number // seconds
  updated_at: number // seconds
}

interface TicketDetailResponse {
  id: number
  user_id: number
  subject: string
  level: number
  status: number
  reply_status: number
  created_at: number
  updated_at: number
  message: Array<{
    id: number
    user_id: number
    ticket_id: number
    message: string
    created_at: number
    updated_at: number
    is_me: boolean
  }>
}

const Support: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { appConfig } = useAppConfig()
  const auth = useMemo(() => createUserAuthUtils(appConfig), [appConfig])
  const getBaseUrl = useCallback(() => getActiveBackendApiBaseUrl(appConfig), [appConfig])

  const [loadingList, setLoadingList] = useState(false)
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [errorModal, setErrorModal] = useState<{ open: boolean; title?: string; message?: string }>({ open: false })

  // Create ticket form
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const levelRef = useRef<number>(0)
  const [submitting, setSubmitting] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadingLog, setUploadingLog] = useState(false)

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [closing, setClosing] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!auth.isLoggedIn()) {
      try {
        // @ts-ignore
        new Notification(t('support.loginRequired') || '请先登录')
      } catch {}
      navigate('/user-center', { replace: true })
    }
  }, [auth, navigate, t])

  const authHeaders = useCallback((): HeadersInit => {
    const token = auth.getToken()
    return {
      'Authorization': token || '',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': API_USER_AGENT
    }
  }, [auth])

  const handleHttpError = async (res: Response): Promise<never> => {
    // Handle 401 Unauthorized - clear token and redirect to login
    if (res.status === 401) {
      auth.clearToken()
      navigate('/user-center', { replace: true })
      throw new Error('登录已过期')
    }

    let text = ''
    try {
      text = await res.text()
    } catch {}
    let message = text || 'Server Error'
    // Try to extract readable message from JSON
    try {
      const obj = JSON.parse(text)
      if (obj) {
        const keys = ['message', 'msg', 'error', 'detail', 'info']
        for (const k of keys) {
          const val = (obj as any)[k]
          if (typeof val === 'string' && val.trim()) {
            message = val
            break
          }
        }
        if (message === text && Array.isArray((obj as any).errors) && (obj as any).errors.length) {
          const first = (obj as any).errors[0]
          if (typeof first === 'string') message = first
          else if (first && typeof first.message === 'string') message = first.message
        }
      }
    } catch {}
    setErrorModal({ open: true, title: `HTTP ${res.status}`, message })
    throw new Error(`HTTP ${res.status}`)
  }

  const fetchTickets = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch(`${getBaseUrl()}/user/ticket/fetch`, {
        method: 'GET',
        headers: {
          'Authorization': auth.getToken() || '',
          'User-Agent': API_USER_AGENT
        }
      })
      if (!res.ok) return handleHttpError(res)
      const data = await res.json()
      setTickets((data.data || []) as TicketItem[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingList(false)
    }
  }, [auth, getBaseUrl])

  useEffect(() => {
    if (auth.isLoggedIn()) fetchTickets()
  }, [auth, fetchTickets])

  const formatDate = (sec: number): string => dayjs.unix(sec).format('DD/MM/YYYY')

  const openDetail = async (id: number) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setReplyText('')
    try {
      const url = `${getBaseUrl()}/user/ticket/fetch?id=${encodeURIComponent(id)}`
      const res = await fetch(url, {
        headers: {
          'Authorization': auth.getToken() || '',
          'User-Agent': API_USER_AGENT
        }
      })
      if (!res.ok) return handleHttpError(res)
      const data = await res.json()
      setDetail(data.data as TicketDetailResponse)
    } catch (e) {
      console.error(e)
    } finally {
      setDetailLoading(false)
    }
  }

  // Auto-scroll to latest message when opening detail or messages update
  useEffect(() => {
    if (!detailOpen || detailLoading) return
    const el = scrollContainerRef.current
    if (el) {
      // next tick to ensure content rendered
      setTimeout(() => {
        el.scrollTop = el.scrollHeight
      }, 0)
    }
  }, [detailOpen, detailLoading, detail?.message?.length])

  const submitTicket = async (subjectArg?: string, messageArg?: string): Promise<void> => {
    const s = (subjectArg ?? subject).trim()
    const m = (messageArg ?? message).trim()
    if (!s || !m) return
    setSubmitting(true)
    try {
      const body = new URLSearchParams()
      body.set('subject', s)
      body.set('level', String(levelRef.current ?? 0))
      body.set('message', m)
      const res = await fetch(`${getBaseUrl()}/user/ticket/save`, {
        method: 'POST',
        headers: authHeaders(),
        body: body.toString()
      })
      if (!res.ok) return handleHttpError(res)
      if (!subjectArg) setSubject('')
      if (!messageArg) setMessage('')
      setCreateOpen(false)
      await fetchTickets()
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  const submitLogTicket = async (): Promise<void> => {
    setUploadingLog(true)
    try {
      const info = await readLatestLogTail(200)
      if (!info) {
        setErrorModal({ open: true, title: t('support.error.title') || 'Error', message: t('support.log.notFound') || 'No log file found' })
        return
      }
      await submitTicket(info.filename, info.content)
    } catch (e) {
      console.error(e)
    } finally {
      setUploadingLog(false)
    }
  }

  const sendReply = async (): Promise<void> => {
    if (!detail || !replyText.trim()) return
    setReplySending(true)
    try {
      const body = new URLSearchParams()
      body.set('id', String(detail.id))
      body.set('message', replyText.trim())
      const res = await fetch(`${getBaseUrl()}/user/ticket/reply`, {
        method: 'POST',
        headers: authHeaders(),
        body: body.toString()
      })
      if (!res.ok) return handleHttpError(res)
      setReplyText('')
      // Refresh detail
      await openDetail(detail.id)
      await fetchTickets()
    } catch (e) {
      console.error(e)
    } finally {
      setReplySending(false)
    }
  }

  const closeTicket = async (): Promise<void> => {
    if (!detail) return
    setClosing(true)
    try {
      const body = new URLSearchParams()
      body.set('id', String(detail.id))
      const res = await fetch(`${getBaseUrl()}/user/ticket/close`, {
        method: 'POST',
        headers: authHeaders(),
        body: body.toString()
      })
      if (!res.ok) return handleHttpError(res)
      setDetailOpen(false)
      setDetail(null)
      await fetchTickets()
    } catch (e) {
      console.error(e)
    } finally {
      setClosing(false)
    }
  }

  return (
    <BasePage title={t('sider.cards.support')}>
      <div className="p-4 grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex justify-between">
            <div className="text-lg font-semibold">{t('support.list.title')}</div>
            <div className="flex gap-2">
              <Button size="sm" color="primary" onPress={() => setCreateOpen(true)}>
                {t('support.create.title')}
              </Button>
              <Button size="sm" color="secondary" onPress={submitLogTicket} isLoading={uploadingLog}>
                {t('support.create.submitLog')}
              </Button>
              <Button size="sm" variant="light" onPress={fetchTickets} isLoading={loadingList}>
                {t('support.list.refresh')}
              </Button>
            </div>
          </CardHeader>
          <Divider />
          <CardBody>
            {loadingList ? (
              <div className="flex items-center justify-center py-8"><Spinner /></div>
            ) : (
              <div className="w-full">
                <div className="grid grid-cols-6 px-2 py-2 text-sm text-default-500">
                  <div>{t('support.columns.id')}</div>
                  <div className="col-span-2">{t('support.columns.subject')}</div>
                  <div>{t('support.columns.status')}</div>
                  <div>{t('support.columns.lastReply')}</div>
                  <div className="text-right">{t('support.columns.actions')}</div>
                </div>
                <Divider />
                {tickets.map((tk) => (
                  <div key={tk.id} className="grid grid-cols-6 items-center px-2 py-3 hover:bg-content2 rounded-md">
                    <div>#{tk.id}</div>
                    <div className="col-span-2 truncate">{tk.subject}</div>
                    <div>
                      {tk.status === 1 ? (
                        <Chip color="danger" variant="flat" size="sm">{t('support.status.closed')}</Chip>
                      ) : (
                        <Chip color="success" variant="flat" size="sm">{t('support.status.open')}</Chip>
                      )}
                    </div>
                    <div>{formatDate(tk.updated_at || tk.created_at)}</div>
                    <div className="text-right">
                      <Button
                        size="sm"
                        color={tk.reply_status === 1 ? 'danger' : 'default'}
                        variant={tk.reply_status === 1 ? 'solid' : 'light'}
                        onPress={() => openDetail(tk.id)}
                      >
                        {t('support.actions.view')}
                      </Button>
                    </div>
                  </div>
                ))}
                {tickets.length === 0 && (
                  <div className="text-center text-default-500 py-8">{t('support.list.empty')}</div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onOpenChange={setDetailOpen} size="xl" scrollBehavior="inside">
        <ModalContent className="h-[80vh] w-[calc(100%-100px)]">
          <ModalHeader className="flex justify-between">
            <div className="font-semibold truncate">
              {detail ? `${t('support.modal.title')} #${detail.id} - ${detail.subject}` : t('support.modal.title')}
            </div>
          </ModalHeader>
          <ModalBody className="h-full flex flex-col">
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pr-1">
              {detailLoading ? (
                <div className="flex items-center justify-center py-8"><Spinner /></div>
              ) : detail ? (
                <div className="flex flex-col gap-3">
                  {detail.message?.map((m) => (
                    <div key={m.id} className={`flex ${m.is_me ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-md px-3 py-2 ${m.is_me ? 'bg-primary text-primary-foreground' : 'bg-content2'}`}>
                        <div className="text-sm whitespace-pre-wrap break-words">{m.message}</div>
                        <div className="text-xs opacity-70 mt-1 text-right">{formatDate(m.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter className="flex-col gap-2 items-stretch">
            {detail?.status === 1 ? (
              <div className="text-default-500 text-sm">{t('support.modal.closedHint')}</div>
            ) : (
              <Textarea
                label={t('support.modal.reply')}
                placeholder={t('support.modal.replyPlaceholder') as string}
                value={replyText}
                onValueChange={setReplyText}
                minRows={2}
              />
            )}
            <div className="w-full flex justify-end gap-2">
              {detail?.status !== 1 && (
                <>
                  <Button color="danger" variant="flat" isLoading={closing} onPress={closeTicket}>{t('support.modal.closeTicket')}</Button>
                  <Button color="primary" isLoading={replySending} onPress={sendReply}>{t('support.modal.send')}</Button>
                </>
              )}
            </div>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Create Ticket Modal */}
      <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
        <ModalContent>
          <ModalHeader className="font-semibold">{t('support.create.title')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('support.create.subject')}
              placeholder={t('support.create.subjectPlaceholder') as string}
              value={subject}
              onValueChange={setSubject}
            />
            <Textarea
              label={t('support.create.message')}
              placeholder={t('support.create.messagePlaceholder') as string}
              value={message}
              onValueChange={setMessage}
              minRows={4}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button color="primary" isLoading={submitting} onPress={() => void submitTicket()}>{t('support.create.submit')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Error Modal */}
      <Modal isOpen={errorModal.open} onOpenChange={(open) => setErrorModal(prev => ({ ...prev, open }))}>
        <ModalContent>
          <ModalHeader>{errorModal.title || t('support.error.title')}</ModalHeader>
          <ModalBody>
            <div className="whitespace-pre-wrap break-words text-sm">{errorModal.message}</div>
          </ModalBody>
          <ModalFooter>
            <Button onPress={() => setErrorModal({ open: false })}>{t('common.close')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </BasePage>
  )
}

export default Support
