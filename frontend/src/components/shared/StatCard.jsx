import React from 'react'

/**
 * A statistics card showing a large numeric value with a descriptive title.
 *
 * Props:
 *  - title   (string)             – label displayed below the value
 *  - value   (string | number)    – the primary stat to display
 *  - icon    (ReactNode, optional)– icon/emoji shown in the header area
 *  - trend   (object, optional)   – { direction: 'up'|'down', label: string }
 *  - onClick (function, optional) – makes the card clickable
 */
export default function StatCard({ title, value, icon, trend, onClick }) {
  const clickable = typeof onClick === 'function'

  return (
    <div
      className={`stat-card${clickable ? ' stat-card--clickable' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <div className="stat-card__header">
        {icon && (
          <div className="stat-card__icon" aria-hidden="true">
            {icon}
          </div>
        )}
        {trend && (
          <span className={`stat-card__trend stat-card__trend--${trend.direction}`}>
            {trend.direction === 'up' ? '\u2191' : '\u2193'} {trend.label}
          </span>
        )}
      </div>

      <div className="stat-card__value">{value}</div>
      <div className="stat-card__title">{title}</div>
    </div>
  )
}
