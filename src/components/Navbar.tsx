'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { LayoutDashboard, PackagePlus, PackageMinus, BarChart3, Package, LogOut, Menu, X } from 'lucide-react'

const links = [
  { href: '/admin',         label: 'Dashboard',         icon: LayoutDashboard },
  { href: '/admin/barang',  label: 'Master Barang',      icon: Package },
  { href: '/admin/masuk',   label: 'Persediaan Masuk',   icon: PackagePlus },
  { href: '/admin/keluar',  label: 'Persediaan Keluar',  icon: PackageMinus },
  { href: '/admin/stok',    label: 'Laporan Stok',       icon: BarChart3 },
]

export default function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  const isLoginPage = pathname === '/admin/login'

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-16 justify-between">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <img
              src="/header_sdmk.svg"
              alt="SDMK"
              className="h-9 w-auto"
            />
            <div className="h-7 w-px bg-gray-200" />
            <span className="font-bold text-gray-900 text-base whitespace-nowrap tracking-tight">
              Persediaan SDMK
            </span>
          </div>

          {/* Desktop nav */}
          {!isLoginPage && (
            <div className="hidden md:flex items-center gap-1">
              {links.map(({ href, label, icon: Icon }) => {
                const active = pathname === href
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </Link>
                )
              })}
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-2">
            {!isLoginPage && (
              <button
                onClick={handleLogout}
                className="hidden md:flex items-center gap-1.5 text-sm text-gray-600 px-3 py-2 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <LogOut size={15} />
                Keluar
              </button>
            )}
            {!isLoginPage && (
              <button
                className="md:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                onClick={() => setOpen(!open)}
              >
                {open ? <X size={20} /> : <Menu size={20} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4 pt-2 space-y-1 animate-fade-in-up">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            )
          })}
          {!isLoginPage && (
            <button
              onClick={() => { setOpen(false); handleLogout() }}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors mt-2"
            >
              <LogOut size={16} />
              Keluar
            </button>
          )}
        </div>
      )}
    </nav>
  )
}
