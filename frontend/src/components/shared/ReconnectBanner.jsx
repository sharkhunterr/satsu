import React, { useContext, useState, useEffect } from 'react'
import { WebSocketContext } from '../../App'

export default function ReconnectBanner() {
  const ws = useContext(WebSocketContext)
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!ws) return
    if (!ws.connected) {
      // Show banner after a short delay (avoid flashing on quick reconnects)
      const timer = setTimeout(() => {
        setVisible(true)
        setDismissed(false)
      }, 2000)
      return () => clearTimeout(timer)
    } else {
      // Auto-dismiss on reconnect
      if (visible) {
        const timer = setTimeout(() => setVisible(false), 2000)
        return () => clearTimeout(timer)
      }
      setVisible(false)
    }
  }, [ws?.connected])

  if (!visible || dismissed) return null

  return (
    <>
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 'var(--z-toast, 400)',
        background: ws?.connected ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)',
        color: '#fff',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        fontSize: '14px',
        fontWeight: 500,
        animation: 'slideDown 300ms ease-out',
      }}>
        {ws?.connected ? (
          <span>Reconnected</span>
        ) : (
          <>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#fff',
              animation: 'pulse 1s ease-in-out infinite'
            }} />
            <span>Connection lost. Reconnecting...</span>
          </>
        )}
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', marginLeft: 8, fontSize: 16,
          }}
        >
          &times;
        </button>
      </div>
    </>
  )
}
