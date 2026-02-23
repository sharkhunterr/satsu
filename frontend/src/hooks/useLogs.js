import { useState, useEffect, useCallback, useRef, useContext } from 'react'
import { WebSocketContext } from '../App'

export function useLogs({ maxBuffer = 1000 } = {}) {
  const [logs, setLogs] = useState([])
  const [paused, setPaused] = useState(false)
  const [newCount, setNewCount] = useState(0) // count of new logs while paused
  const [loading, setLoading] = useState(false)
  const ws = useContext(WebSocketContext)
  const pausedRef = useRef(false)

  // Keep ref in sync
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Subscribe to real-time log events
  useEffect(() => {
    if (!ws?.subscribe) return
    return ws.subscribe('log', (data) => {
      if (pausedRef.current) {
        setNewCount(c => c + 1)
        return
      }
      setLogs(prev => {
        const updated = [...prev, data]
        // Trim to maxBuffer
        if (updated.length > maxBuffer) {
          return updated.slice(updated.length - maxBuffer)
        }
        return updated
      })
    })
  }, [ws, maxBuffer])

  // Pause/resume
  const pause = useCallback(() => {
    setPaused(true)
    setNewCount(0)
  }, [])

  const resume = useCallback(() => {
    setPaused(false)
    setNewCount(0)
  }, [])

  // Clear display
  const clear = useCallback(() => {
    setLogs([])
    setNewCount(0)
  }, [])

  // Fetch historical logs
  const fetchLogs = useCallback(async (params = {}) => {
    try {
      setLoading(true)
      const searchParams = new URLSearchParams()
      if (params.cursor) searchParams.set('cursor', params.cursor)
      if (params.limit) searchParams.set('limit', params.limit)
      if (params.level?.length) params.level.forEach(l => searchParams.append('level', l))
      if (params.category) searchParams.set('category', params.category)
      if (params.device_mac) searchParams.set('device_mac', params.device_mac)
      if (params.search) searchParams.set('search', params.search)
      if (params.date_from) searchParams.set('date_from', params.date_from)
      if (params.date_to) searchParams.set('date_to', params.date_to)

      const res = await fetch(`/api/logs?${searchParams}`)
      if (!res.ok) throw new Error('Failed to fetch logs')
      return await res.json()
    } catch (err) {
      return { items: [], cursor: null, total: 0, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    logs,
    paused,
    newCount,
    loading,
    pause,
    resume,
    clear,
    fetchLogs,
  }
}
