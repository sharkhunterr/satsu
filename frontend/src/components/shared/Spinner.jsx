import React from 'react'

/**
 * CSS-only loading spinner.
 *
 * Props:
 *  - size     ('sm' | 'md' | 'lg') – spinner diameter (default 'md')
 *  - fullPage (boolean)             – if true, centers the spinner in a tall container
 *  - label    (string, optional)    – accessible label (default "Loading")
 */
export default function Spinner({ size = 'md', fullPage = false, label = 'Loading' }) {
  const spinner = (
    <span
      className={`spinner spinner--${size}`}
      role="status"
      aria-label={label}
    />
  )

  if (fullPage) {
    return <div className="spinner-fullpage">{spinner}</div>
  }

  return spinner
}
