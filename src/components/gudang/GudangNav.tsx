'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Activity, CalendarRange, Wrench, ScrollText, LayoutDashboard, LogOut, Menu, X } from 'lucide-react'

const links = [
  { href: '/gudang',              label: 'Kontinuitas',         icon: Activity },
  { href: '/gudang/snapshot',     label: 'Snapshot & Rollover', icon: CalendarRange },
  { href: '/gudang/pemeliharaan', label: 'Pemeliharaan',        icon: Wrench },
  { href: '/gudang/log',          label: 'Log Perubahan',       icon: ScrollText },
]

export default function GudangNav({ nama }: { nama: string | null }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const showLinks = pathname !== '/gudang/login' && nama !== null

  async function handleLogout() {
    await fetch('/api/gudang/logout', { method: 'POST' })
    // Muat penuh, supaya layout membaca ulang sesi (nama petugas hilang dari nav).
    window.location.href = '/gudang/login'
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-16 justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/header_sdmk.svg" alt="SDMK" className="h-9 w-auto" />
            <div className="h-7 w-px bg-gray-200" />
            <span className="font-bold text-gray-900 text-base whitespace-nowrap tracking-tight">Persediaan SDMK</span>
            <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Gudang</span>
          </div>

          {showLinks && (
            <div className="hidden lg:flex items-center gap-1">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    pathname === href ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <Icon size={15} />
                  {label}
                </Link>
              ))}
            </div>
          )}

          {showLinks && (
            <div className="flex items-center gap-2">
              <span className="hidden xl:inline text-sm text-gray-500">{nama}</span>
              <Link href="/admin" className="hidden lg:flex items-center gap-1.5 text-sm text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100">
                <LayoutDashboard size={15} />
                Admin
              </Link>
              <button
                onClick={handleLogout}
                className="hidden lg:flex items-center gap-1.5 text-sm text-gray-600 px-3 py-2 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <LogOut size={15} />
                Keluar
              </button>
              <button className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600" onClick={() => setOpen(!open)}>
                {open ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {showLinks && open && (
        <div className="lg:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2 space-y-1 animate-fade-in-up">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                pathname === href ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
          <Link href="/admin" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">
            <LayoutDashboard size={16} />
            Admin
          </Link>
          <button
            onClick={() => { setOpen(false); handleLogout() }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 mt-2"
          >
            <LogOut size={16} />
            Keluar ({nama})
          </button>
        </div>
      )}
    </nav>
  )
}
