'use client'

import { useCallback, useEffect, useState } from 'react'
import { getBarangGrouped, type Barang, type BarangGrouped, type KeluarType } from '@/lib/api'

const PAGE_SIZE = 10

const TABS: { value: KeluarType; label: string }[] = [
  { value: 'atk', label: 'ATK' },
  { value: 'rt', label: 'Rumah Tangga' },
  { value: 'obat', label: 'Obat' },
]

export default function BarangPage() {
  const [grouped, setGrouped] = useState<BarangGrouped>({ atk: [], rt: [], obat: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<KeluarType>('atk')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setGrouped(await getBarangGrouped())
    } catch {
      setError('Gagal memuat data barang.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, activeTab])

  const data: Barang[] = grouped[activeTab]
  const q = search.toLowerCase()
  const filtered = data.filter(
    (b) =>
      b.kode_barang.toLowerCase().includes(q) ||
      b.nama_barang.toLowerCase().includes(q) ||
      b.merk.toLowerCase().includes(q)
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Master Barang</h1>
        <button
          onClick={load}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setActiveTab(t.value); setSearch('') }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === t.value
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {!loading && (
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {grouped[t.value].length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="px-4 py-3 border-b">
          <input
            type="text"
            placeholder="Cari kode, nama, atau merk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="p-6 text-red-600 text-sm">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">No</th>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Kode Barang</th>
                  <th className="px-4 py-3 text-left">Nama Barang</th>
                  <th className="px-4 py-3 text-left">Merk</th>
                  <th className="px-4 py-3 text-left">Satuan</th>
                  <th className="px-4 py-3 text-right">Saldo Awal</th>
                  <th className="px-4 py-3 text-right">Sisa Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-gray-400">
                      Tidak ada data barang
                    </td>
                  </tr>
                ) : (
                  paginated.map((b, i) => (
                    <tr key={`${b.kode_barang}-${i}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{b.id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{b.kode_barang}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{b.nama_barang}</td>
                      <td className="px-4 py-3 text-gray-600">{b.merk}</td>
                      <td className="px-4 py-3 text-gray-600">{b.satuan}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{b.saldo_awal}</td>
                      <td className={`px-4 py-3 text-right font-bold ${b.sisa_saldo <= 0 ? 'text-red-600' : 'text-blue-600'}`}>{b.sisa_saldo}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-gray-500">
            Menampilkan {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} dari {filtered.length} barang
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2 py-1 rounded text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | '...')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
                  acc.push(p)
                  return acc
                }, [])
                .map((p, idx) =>
                  p === '...' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 py-1 text-sm text-gray-400">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`px-3 py-1 rounded text-sm border ${
                        currentPage === p
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2 py-1 rounded text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

