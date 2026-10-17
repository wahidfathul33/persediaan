'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function LoginForm() {
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/gudang'

  const [nama, setNama] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/gudang/login?from=${encodeURIComponent(from)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        // Muat penuh, supaya layout membaca sesi baru dan menampilkan menu.
        window.location.href = data.redirect || '/gudang'
        return
      }
      setError(data.error || 'Login gagal')
    } catch {
      setError('Terjadi kesalahan. Coba lagi.')
    }
    setLoading(false)
  }

  return (
    <div className="flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/header_sdmk.svg" alt="SDMK" className="h-9 w-auto mx-auto block" />
          <h1 className="text-xl font-bold text-gray-800 mt-4">Login Gudang</h1>
          <p className="text-sm text-gray-500 mt-1">Password gudang berbeda dari password admin.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="nama" className="block text-sm font-medium text-gray-700 mb-1">Nama petugas</label>
            <input
              id="nama"
              type="text"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              autoFocus
              maxLength={40}
              placeholder="Dicatat di log perubahan"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password gudang</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? 'border-red-400' : 'border-gray-300'}`}
            />
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading || !password || nama.trim().length < 2}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Memverifikasi...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function GudangLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
