'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

type ToastType = 'success' | 'error'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

const TOAST_DURATION_MS = 3000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  // unmount 後に自動消滅のタイマーが残ると、環境の teardown の後に発火して unhandled error になりうる。
  useEffect(() => {
    const pending = timersRef.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type }])
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, TOAST_DURATION_MS)
    timersRef.current.add(timer)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div aria-live="polite" className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`toast toast-${toast.type}`}
          >
            {/* デザイン準拠のアイコン（app-ui.html L2097）。error はデザインに定義がないため「!」を採用 */}
            <div className="toast-icon" aria-hidden="true">
              {toast.type === 'success' ? '✓' : '!'}
            </div>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}
