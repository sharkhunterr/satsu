import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconHome, IconHistory, IconDevices,
  IconLogs, IconSettings, IconInfo, IconChevronLeft, IconChevronRight,
} from '../shared/Icons'

const NAV_ITEMS = [
  { to: '/', icon: <IconHome />, label: 'Home' },
  { to: '/history', icon: <IconHistory />, label: 'History' },
  { to: '/devices', icon: <IconDevices />, label: 'Devices' },
  { to: '/logs', icon: <IconLogs />, label: 'Logs' },
  { to: '/settings', icon: <IconSettings />, label: 'Settings' },
  { to: '/about', icon: <IconInfo />, label: 'About' },
]

export default function Sidebar({ expanded, onToggle }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__logo">Satsu</span>
        <button
          className="sidebar__toggle"
          onClick={onToggle}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? <IconChevronLeft /> : <IconChevronRight />}
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
            }
            title={item.label}
          >
            <span className="sidebar__link-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="sidebar__link-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        Satsu v1.0
      </div>
    </aside>
  )
}
