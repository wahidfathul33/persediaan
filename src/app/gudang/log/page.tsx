'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getLogGudang, TYPE_LABEL, type LogEntry } from '@/lib/gudang'
import type { KeluarType } from '@/lib/api'

export default function LogPage() {
  const [log, setLog] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setLog(await getLogGudang())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat log.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Log perubahan</h1>
          <p className="text-sm text-gray-500 mt-1">Semua perubahan dari menu Gudang beserta alasannya.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Muat ulang
        </button>
      </div>

      {error && <div className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2 text-left font-semibold">Waktu</th>
              <th className="px-4 py-2 text-left font-semibold">Petugas</th>
              <th className="px-4 py-2 text-left font-semibold">Aksi</th>
              <th className="px-4 py-2 text-left font-semibold">Barang</th>
              <th className="px-4 py-2 text-left font-semibold">Perubahan</th>
              <th className="px-4 py-2 text-left font-semibold">Alasan</th>
            </tr>
          </thead>
          <tbody>
            {loading && log.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Memuat…</td></tr>}
            {!loading && log.length === 0 && !error && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Belum ada perubahan dari menu Gudang.</td></tr>}
            {log.map((l, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-gray-600">{l.waktu}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{l.petugas}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{l.aksi}</td>
                <td className="px-4 py-2.5">
                  {l.nama_barang || '—'}
                  {l.type && <span className="text-xs text-gray-500"> ({TYPE_LABEL[l.type as KeluarType] ?? l.type})</span>}
                </td>
                <td className="px-4 py-2.5 text-gray-700">{l.ringkasan}</td>
                <td className="px-4 py-2.5 text-gray-700">{l.alasan}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
