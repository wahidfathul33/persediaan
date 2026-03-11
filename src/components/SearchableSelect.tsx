'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ring?: 'blue' | 'orange'
  error?: boolean
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Pilih...',
  disabled = false,
  ring = 'blue',
  error = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const selected = options.find((o) => o.value === value)
  const filtered = !search
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))

  // Close on outside click (exclude both trigger and portal dropdown)
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll/resize to avoid stale dropdown position
  // Ignore scroll events that originate inside the dropdown options list itself
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setSearch('')
    }
    window.addEventListener('scroll', handler, { capture: true, passive: true })
    window.addEventListener('resize', handler, { passive: true })
    return () => {
      window.removeEventListener('scroll', handler, { capture: true })
      window.removeEventListener('resize', handler)
    }
  }, [open])

  function openDropdown() {
    if (disabled) return
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setSearch('')
    setOpen(true)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  function closeDropdown() {
    setOpen(false)
    setSearch('')
  }

  function handleSelect(val: string) {
    onChange(val)
    closeDropdown()
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    closeDropdown()
  }

  const openRingCls =
    ring === 'orange'
      ? 'ring-2 ring-orange-400 border-orange-300'
      : 'ring-2 ring-blue-500 border-blue-400'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeDropdown() : openDropdown())}
        disabled={disabled}
        className={`w-full flex items-center justify-between border rounded-lg bg-white text-sm transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'hover:border-gray-400 cursor-pointer'}
          ${open ? openRingCls : error ? 'border-red-400' : 'border-gray-300'}
        `}
      >
        <span
          className={`flex-1 px-3 py-2 text-left truncate ${
            selected ? 'text-gray-800' : 'text-gray-400'
          }`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <div className="flex items-center gap-1 pr-2 shrink-0">
          {value && !disabled && (
            <span
              role="button"
              onClick={handleClear}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-base leading-none"
            >
              ×
            </span>
          )}
          <span
            className={`text-gray-400 text-xs leading-none transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          >
            ▾
          </span>
        </div>
      </button>

      {mounted &&
        open &&
        rect &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
              zIndex: 9999,
            }}
            className="bg-white border border-gray-200 rounded-lg shadow-2xl"
          >
            <div className="p-2 border-b border-gray-100">
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeDropdown() }}
                placeholder="Cari..."
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-sm text-gray-400 text-center">
                  Tidak ditemukan
                </div>
              ) : (
                filtered.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      opt.value === value
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
