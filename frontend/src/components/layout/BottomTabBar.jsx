import React, { useState, useRef, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  IconHome, IconHistory, IconDevices,
  IconLogs, IconSettings, IconMore,
} from '../shared/Icons'

const PRIMARY_TABS = [
  { to: '/', icon: <IconHome />, label: 'Home' },
  { to: '/history', icon: <IconHistory />, label: 'History' },
  { to: '/devices', icon: <IconDevices />, label: 'Devices' },
]

const MORE_ITEMS = [
  { to: '/logs', icon: <IconLogs />, label: 'Logs' },
  { to: '/settings', icon: <IconSettings />, label: 'Settings' },
]

export default function BottomTabBar() {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)
  const location = useLocation()

  // Close menu when navigating
  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

  // Close menu when clicking outside
  useEffect(() => {
    if (!moreOpen) return

    const handleClick = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false)
      }
    }

    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [moreOpen])

  // Determine if any "More" sub-item is currently active
  const isMoreActive = MORE_ITEMS.some((item) => location.pathname === item.to)

  return (
    <nav className="bottom-tab-bar" role="navigation" aria-label="Main navigation">
      {PRIMARY_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `bottom-tab-bar__item${isActive ? ' bottom-tab-bar__item--active' : ''}`
          }
        >
          <span className="bottom-tab-bar__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="bottom-tab-bar__label">{tab.label}</span>
        </NavLink>
      ))}

      {/* More tab with dropdown */}
      <div ref={moreRef} style={{ position: 'relative', flex: 1, display: 'flex' }}>
        <button
          type="button"
          className={`bottom-tab-bar__item${isMoreActive ? ' bottom-tab-bar__item--active' : ''}`}
          onClick={() => setMoreOpen((prev) => !prev)}
          aria-expanded={moreOpen}
          aria-haspopup="true"
          style={{
            background: 'none',
            border: 'none',
            fontFamily: 'inherit',
            width: '100%',
            cursor: 'pointer',
          }}
        >
          <span className="bottom-tab-bar__icon" aria-hidden="true">
            <IconMore />
          </span>
          <span className="bottom-tab-bar__label">More</span>
        </button>

        <div
          className={`bottom-tab-bar__more-menu${moreOpen ? ' bottom-tab-bar__more-menu--open' : ''}`}
          role="menu"
        >
          {MORE_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `bottom-tab-bar__more-item${isActive ? ' active' : ''}`
              }
              role="menuitem"
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
