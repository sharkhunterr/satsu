import React from 'react'

/**
 * Top bar shown on mobile viewports.
 * Displays the current page title and a WebSocket connection indicator.
 *
 * Props:
 *  - title     (string)   – current page title
 *  - connected (boolean)  – WebSocket connection status
 *  - actions   (ReactNode, optional) – extra action buttons for the right side
 */
export default function TopBar({ title, connected, actions }) {
  return (
    <header className="top-bar">
      <h1 className="top-bar__title">{title}</h1>

      <div className="top-bar__actions">
        {actions}

        <div className="top-bar__status" title={connected ? 'Connected' : 'Disconnected'}>
          <span
            className={`top-bar__status-dot${connected ? ' top-bar__status-dot--connected' : ''}`}
            aria-hidden="true"
          />
          <span className="sr-only">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </header>
  )
}
