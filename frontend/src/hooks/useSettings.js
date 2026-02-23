import { useState, useEffect, useCallback, useContext } from 'react'
import { WebSocketContext } from '../App'

export function useSettings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const ws = useContext(WebSocketContext)

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error('Failed to fetch settings')
      const data = await res.json()
      setSettings(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Update a specific section
  const updateSection = useCallback(async (section, values) => {
    try {
      const res = await fetch(`/api/settings/${section}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error('Failed to update settings')
      const data = await res.json()
      setSettings(prev => ({ ...prev, [section]: data }))
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }, [])

  // Replace all settings
  const replaceAll = useCallback(async (newSettings) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      })
      if (!res.ok) throw new Error('Failed to replace settings')
      const data = await res.json()
      setSettings(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }, [])

  // Reload on config_changed WebSocket event
  useEffect(() => {
    if (!ws?.subscribe) return
    return ws.subscribe('config_changed', () => {
      fetchSettings()
    })
  }, [ws, fetchSettings])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  return { settings, loading, error, updateSection, replaceAll, refetch: fetchSettings }
}
