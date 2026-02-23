import React, { useEffect, useRef } from 'react'

/**
 * Confirmation dialog with modal overlay.
 *
 * Props:
 *  - open        (boolean)  – whether the dialog is visible
 *  - title       (string)   – dialog heading
 *  - message     (string)   – descriptive text
 *  - confirmText (string)   – label for the confirm button (default "Confirm")
 *  - cancelText  (string)   – label for the cancel button (default "Cancel")
 *  - onConfirm   (function) – called when the user confirms
 *  - onCancel    (function) – called when the user cancels or presses Escape
 *  - variant     (string)   – 'danger' | 'default' (affects confirm button style)
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}) {
  const dialogRef = useRef(null)
  const confirmBtnRef = useRef(null)

  // Focus the cancel button when opened (safer default)
  useEffect(() => {
    if (open && dialogRef.current) {
      // Small delay to let the animation start
      const timer = setTimeout(() => {
        dialogRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Close on Escape key
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  const confirmBtnClass =
    variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary'

  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        // Close when clicking the overlay backdrop
        if (e.target === e.currentTarget) {
          onCancel?.()
        }
      }}
      role="presentation"
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2 id="confirm-dialog-title" className="dialog__title">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="dialog__message">
          {message}
        </p>
        <div className="dialog__actions">
          <button className="btn btn-secondary" onClick={onCancel} type="button">
            {cancelText}
          </button>
          <button
            className={confirmBtnClass}
            onClick={onConfirm}
            ref={confirmBtnRef}
            type="button"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
