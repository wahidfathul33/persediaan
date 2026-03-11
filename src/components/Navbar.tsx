'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/barang', label: 'Master Barang' },
  { href: '/masuk', label: 'Persediaan Masuk' },
  { href: '/keluar', label: 'Persediaan Keluar' },
  { href: '/stok', label: 'Laporan Stok' },
]

const STANDALONE_PATHS = ['/keluar/input']

export default function Navbar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  if (STANDALONE_PATHS.includes(pathname)) return null

  return (
    <nav className="bg-blue-700 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-16 justify-between">
          <div className="flex items-center gap-1">
            <span className="font-bold text-lg mr-4 whitespace-nowrap">
              📦 Persediaan SDMK
            </span>
            <div className="hidden md:flex gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                    pathname === l.href
                      ? 'bg-blue-900 text-white'
                      : 'hover:bg-blue-600'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded hover:bg-blue-600"
            onClick={() => setOpen(!open)}
          >
            <span className="block w-5 h-0.5 bg-white mb-1" />
            <span className="block w-5 h-0.5 bg-white mb-1" />
            <span className="block w-5 h-0.5 bg-white" />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-blue-600 px-4 pb-3">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 rounded text-sm font-medium mt-1 transition-colors ${
                pathname === l.href
                  ? 'bg-blue-900 text-white'
                  : 'hover:bg-blue-600'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  )
}
