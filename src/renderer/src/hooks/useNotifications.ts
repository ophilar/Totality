import { useCallback, useEffect, useState } from 'react'

type AppNotification = Awaited<ReturnType<typeof window.electronAPI.notificationsGetAll>>[number]

export function useNotifications({ limit, isOpen, refreshIntervalMs }: {
  limit: number
  isOpen: boolean
  refreshIntervalMs?: number
}) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const loadNotifications = useCallback(async () => {
    try {
      const [items, counts] = await Promise.all([
        window.electronAPI.notificationsGetAll({ limit }),
        window.electronAPI.notificationsGetCount(),
      ])
      setNotifications(items)
      setUnreadCount(counts.unread)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [limit])

  useEffect(() => {
    void loadNotifications()
    if (isOpen && refreshIntervalMs) {
      const interval = setInterval(() => void loadNotifications(), refreshIntervalMs)
      return () => clearInterval(interval)
    }
  }, [isOpen, loadNotifications, refreshIntervalMs])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onNotificationsNew(() => void loadNotifications())
    return unsubscribe
  }, [loadNotifications])

  const runAction = useCallback(async (action: () => Promise<void>) => {
    try {
      await action()
      await loadNotifications()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [loadNotifications])

  const markAllRead = useCallback(() => runAction(() => window.electronAPI.notificationsMarkAllRead()), [runAction])
  const markRead = useCallback((id: number) => runAction(() => window.electronAPI.notificationsMarkRead([id])), [runAction])
  const clear = useCallback(() => runAction(() => window.electronAPI.notificationsClear()), [runAction])

  return { notifications, unreadCount, error, markAllRead, markRead, clear }
}
