'use client'

import { useEffect, useState } from 'react'
import { getStokData, type StokItem } from '@/lib/api'

export default function StokPage() {
  const [data, setData] = useState<StokItem[]>([])
  const [filtered, setFiltered] = useState<StokItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await getStokData()
      setData(result)
      setFiltered(result)
    } catch {
      setError('Gagal memuat data stok.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(
      data.filter(
        (s) =>
          s.kode_barang.toLowerCase().includes(q) ||
          s.nama_barang.toLowerCase().includes(q) ||
          s.merk.toLowerCase().includes(q)
      )
    )
  }, [search, data])

  const totalMasuk = filtered.reduce((sum, s) => sum + s.total_masuk, 0)
  const totalKeluar = filtered.reduce((sum, s) => sum + s.total_keluar, 0)
  const stokAkhir = filtered.reduce((sum, s) => sum + s.stok_akhir, 0)
  const habis = filtered.filter((s) => s.stok_akhir <= 0).length
  const rendah = filtered.filter((s) => s.stok_akhir > 0 && s.stok_akhir <= 5).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Laporan Stok</h1>
        <button onClick={load} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          🔄 Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total Jenis', value: filtered.length, color: 'border-blue-300 bg-blue-50 text-blue-800' },
          { label: 'Total Masuk', value: totalMasuk, color: 'border-green-300 bg-green-50 text-green-800' },
          { label: 'Total Keluar', value: totalKeluar, color: 'border-orange-300 bg-orange-50 text-orange-800' },
          { label: 'Stok Akhir', value: stokAkhir, color: 'border-purple-300 bg-purple-50 text-purple-800' },
          { label: 'Stok Habis', value: habis, color: 'border-red-300 bg-red-50 text-red-800' },
        ].map((c) => (
          <div key={c.label} className={`border rounded-xl p-4 ${c.color}`}>
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-xs mt-1 font-medium opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <input
            type="text"
            placeholder="Cari kode, nama, atau merk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {rendah > 0 && (
            <span className="ml-4 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 px-3 py-1 rounded-full">
              ⚠ {rendah} item stok rendah
            </span>
          )}
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
                  <th className="px-4 py-3 text-left">Kode</th>
                  <th className="px-4 py-3 text-left">Nama Barang</th>
                  <th className="px-4 py-3 text-left">Merk</th>
                  <th className="px-4 py-3 text-left">UOM</th>
                  <th className="px-4 py-3 text-right">Total Masuk</th>
                  <th className="px-4 py-3 text-right">Total Keluar</th>
                  <th className="px-4 py-3 text-right">Stok Akhir</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-gray-400">Belum ada data stok</td></tr>
                ) : (
                  filtered.map((s, i) => (
                    <tr key={s.kode_barang} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.kode_barang}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{s.nama_barang}</td>
                      <td className="px-4 py-3 text-gray-600">{s.merk}</td>
                      <td className="px-4 py-3 text-gray-600">{s.uom}</td>
                      <td className="px-4 py-3 text-right text-green-700 font-medium">{s.total_masuk}</td>
                      <td className="px-4 py-3 text-right text-orange-600 font-medium">{s.total_keluar}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{s.stok_akhir}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            s.stok_akhir <= 0
                              ? 'bg-red-100 text-red-700'
                              : s.stok_akhir <= 5
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {s.stok_akhir <= 0 ? 'Habis' : s.stok_akhir <= 5 ? 'Rendah' : 'Aman'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-gray-50 font-semibold text-gray-700">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-right text-xs uppercase text-gray-500">Total</td>
                    <td className="px-4 py-3 text-right text-green-700">{totalMasuk}</td>
                    <td className="px-4 py-3 text-right text-orange-600">{totalKeluar}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{stokAkhir}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
