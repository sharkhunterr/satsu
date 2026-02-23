import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * React hook for managing a WebSocket connection with automatic reconnection.
 *
 * Returns:
 *  - connected  (boolean)  – whether the socket is currently open
 *  - lastEvent  (object)   – the most recently received parsed message
 *  - subscribe  (function) – subscribe(eventName, callback) -> unsubscribe fn
 *
 * Messages are expected to be JSON with shape { event: string, data: any }.
 * Use the wildcard event name '*' to listen for all events.
 */
export function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState(null)

  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const listenersRef = useRef({}) // event name -> Set<callback>
  const mountedRef = useRef(true)

  /**
   * Schedule a reconnection with exponential back-off.
   * Delay sequence: 1 s, 2 s, 4 s, 5 s (capped).
   */
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return

    const attempt = reconnectAttemptRef.current
    const delay = Math.min(1000 * Math.pow(2, attempt), 5000)
    reconnectAttemptRef.current = attempt + 1

    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connect() // eslint-disable-line no-use-before-define
      }
    }, delay)
  }, []) // connect is added below via the stable ref trick

  /**
   * Open a new WebSocket connection to the server.
   */
  const connect = useCallback(() => {
    // Tear down any existing connection first
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        /* ignore */
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`

    let ws
    try {
      ws = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }

    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      reconnectAttemptRef.current = 0
      setConnected(true)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setConnected(false)
      scheduleReconnect()
    }

    ws.onerror = () => {
      // The browser will also fire onclose after onerror, so we just
      // make sure the socket is closed to trigger the reconnect path.
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }

    ws.onmessage = (e) => {
      if (!mountedRef.current) return

      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return // ignore malformed messages
      }

      setLastEvent(msg)

      // Dispatch to listeners registered for this specific event
      const callbacks = listenersRef.current[msg.event]
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb(msg.data, msg)
          } catch (err) {
            console.error('[useWebSocket] listener error:', err)
          }
        })
      }

      // Dispatch to wildcard listeners
      const wildcardCallbacks = listenersRef.current['*']
      if (wildcardCallbacks) {
        wildcardCallbacks.forEach((cb) => {
          try {
            cb(msg.data, msg)
          } catch (err) {
            console.error('[useWebSocket] wildcard listener error:', err)
          }
        })
      }
    }
  }, [scheduleReconnect])

  /**
   * Subscribe to a named event (or '*' for all events).
   *
   * @param {string}   event    – event name to listen for
   * @param {Function} callback – receives (data, fullMessage)
   * @returns {Function} unsubscribe – call to remove the listener
   */
  const subscribe = useCallback((event, callback) => {
    if (!listenersRef.current[event]) {
      listenersRef.current[event] = new Set()
    }
    listenersRef.current[event].add(callback)

    return () => {
      listenersRef.current[event]?.delete(callback)
      // Clean up empty Sets
      if (listenersRef.current[event]?.size === 0) {
        delete listenersRef.current[event]
      }
    }
  }, [])

  // Establish the connection on mount; tear down on unmount.
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {
          /* ignore */
        }
        wsRef.current = null
      }
    }
  }, [connect])

  return { connected, lastEvent, subscribe }
}
