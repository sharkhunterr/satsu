import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'

/* ==========================================================================
   Toast Context & Provider
   ========================================================================== */

const ToastContext = createContext(null)

/**
 * Access the toast system.
 *
 * Returns an object with helper methods:
 *  - success(message, options?)
 *  - error(message, options?)
 *  - warning(message, options?)
 *  - info(message, options?)
 *  - dismiss(id)
 *
 * Options: { title?: string, duration?: number (ms, default 5000) }
 */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>')
  }
  return ctx
}

/** Icons per toast type */
const TOAST_ICONS = {
  success: '\u2713',
  error: '\u2717',
  warning: '\u26A0',
  info: '\u2139',
}

let nextId = 0

/**
 * Wrap your app with <ToastProvider> to enable the toast notification system.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  /** Remove a toast by id (with exit animation). */
  const dismiss = useCallback((id) => {
    // Mark as exiting first for CSS animation
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    )
    // Remove from DOM after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 220)

    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])

  /** Add a toast and auto-dismiss after `duration` ms. */
  const addToast = useCallback(
    (type, message, options = {}) => {
      const id = ++nextId
      const duration = options.duration ?? 5000
      const toast = {
        id,
        type,
        message,
        title: options.title ?? null,
        exiting: false,
      }

      setToasts((prev) => [...prev, toast])

      if (duration > 0) {
        timersRef.current[id] = setTimeout(() => {
          dismiss(id)
        }, duration)
      }

      return id
    },
    [dismiss]
  )

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout)
    }
  }, [])

  const success = useCallback((msg, opts) => addToast('success', msg, opts), [addToast])
  const error = useCallback((msg, opts) => addToast('error', msg, opts), [addToast])
  const warning = useCallback((msg, opts) => addToast('warning', msg, opts), [addToast])
  const info = useCallback((msg, opts) => addToast('info', msg, opts), [addToast])

  const api = { success, error, warning, info, dismiss }

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toast container */}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}${t.exiting ? ' toast--exiting' : ''}`}
            role="status"
          >
            <span className="toast__icon" aria-hidden="true">
              {TOAST_ICONS[t.type]}
            </span>
            <div className="toast__content">
              {t.title && <div className="toast__title">{t.title}</div>}
              <div className="toast__message">{t.message}</div>
            </div>
            <button
              className="toast__close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
