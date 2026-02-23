import React from 'react'

/**
 * Centered placeholder for empty lists or states.
 *
 * Props:
 *  - icon        (ReactNode, optional) – large icon/emoji displayed at top
 *  - title       (string)              – heading text
 *  - description (string, optional)    – explanatory text below the title
 *  - action      (ReactNode, optional) – e.g. a button to trigger an action
 */
export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state">
      {icon && (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="empty-state__title">{title}</div>
      {description && (
        <div className="empty-state__description">{description}</div>
      )}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  )
}
