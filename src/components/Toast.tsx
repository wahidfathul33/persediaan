'use client'

import { useEffect } from 'react'

type ToastType = 'error' | 'success' | 'info'

interface Props {
  message: string
  type?: ToastType
  onClose: () => void
  duration?: number
}

const STYLES: Record<ToastType, string> = {
  error:   'bg-red-500 text-white',
  success: 'bg-green-500 text-white',
  info:    'bg-gray-800 text-white',
}

export default function Toast({ message, type = 'error', onClose, duration = 3000 }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, duration)
    return () => clearTimeout(t)
  }, [onClose, duration])

  return (
    <div className="fixed top-5 right-5 z-[9999] animate-fade-in-up">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${STYLES[type]}`}>
        <span>{message}</span>
        <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100 transition-opacity text-base leading-none">
          ✕
        </button>
      </div>
    </div>
  )
}
