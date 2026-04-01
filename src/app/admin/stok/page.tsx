'use client'

import { useEffect, useState } from 'react'
import { getStokData, type StokItem } from '@/lib/api'

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

export default function StokPage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState<StokItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await getStokData(month, year)
      setData(result)
    } catch {
      setError('Gagal memuat data stok.')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [month, year])

  const q = search.toLowerCase()
  const filtered = data.filter(
    (s) =>
      String(s.kode_barang ?? '').toLowerCase().includes(q) ||
      String(s.nama_barang ?? '').toLowerCase().includes(q) ||
      String(s.merk ?? '').toLowerCase().includes(q)
  )

  const daysInMonth = data[0]?.days_in_month ?? 30
  const totalPemakaian = filtered.reduce((sum, s) => sum + s.total_pemakaian, 0)
  const habis = filtered.filter((s) => s.sisa_saldo <= 0).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Laporan Stok</h1>
        <button onClick={load} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          🔄 Refresh
        </button>
      </div>

      {/* Month/year filter */}
      {/* Month/year picker */}
      <div className="inline-flex items-center gap-0 mb-4 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => {
            if (month === 1) { setMonth(12); setYear((y) => y - 1) }
            else setMonth((m) => m - 1)
          }}
          className="px-3 py-2.5 text-gray-500 hover:bg-gray-100 transition-colors text-lg leading-none"
        >
          ‹
        </button>
        <div className="flex items-center gap-2 px-3 py-2 border-x border-gray-200">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="text-sm font-semibold text-gray-800 bg-transparent focus:outline-none cursor-pointer"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-sm font-semibold text-gray-800 bg-transparent w-16 focus:outline-none text-center"
            min={2020}
            max={2099}
          />
        </div>
        <button
          onClick={() => {
            if (month === 12) { setMonth(1); setYear((y) => y + 1) }
            else setMonth((m) => m + 1)
          }}
          className="px-3 py-2.5 text-gray-500 hover:bg-gray-100 transition-colors text-lg leading-none"
        >
          ›
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Jenis', value: filtered.length, color: 'border-blue-300 bg-blue-50 text-blue-800' },
          { label: 'Total Pemakaian', value: totalPemakaian, color: 'border-orange-300 bg-orange-50 text-orange-800' },
          { label: 'Stok Habis', value: habis, color: 'border-red-300 bg-red-50 text-red-800' },
          { label: 'Periode', value: `${MONTHS[month - 1]} ${year}`, color: 'border-gray-300 bg-gray-50 text-gray-800' },
        ].map((c) => (
          <div key={c.label} className={`border rounded-xl p-4 ${c.color}`}>
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-xs mt-1 font-medium opacity-80">{c.label}</div>
          </div>
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
            <table className="text-sm border-collapse">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-3 py-3 text-left border border-gray-200 min-w-[32px]">No</th>
                  <th className="px-3 py-3 text-left border border-gray-200 min-w-[80px]">Kode</th>
                  <th className="px-3 py-3 text-left border border-gray-200 min-w-[160px]">Nama Barang</th>
                  <th className="px-3 py-3 text-left border border-gray-200 min-w-[80px]">Merk</th>
                  <th className="px-3 py-3 text-left border border-gray-200 min-w-[60px]">Satuan</th>
                  <th className="px-3 py-3 text-right border border-gray-200 min-w-[70px]">Saldo Awal</th>
                  {Array.from({ length: daysInMonth }, (_, i) => (
                    <th key={i} className="px-1 py-3 text-center border border-gray-200 min-w-[30px]">{i + 1}</th>
                  ))}
                  <th className="px-3 py-3 text-right border border-gray-200 min-w-[90px] text-orange-600">Total Pakai</th>
                  <th className="px-3 py-3 text-right border border-gray-200 min-w-[80px] text-blue-600">Sisa Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6 + daysInMonth + 2} className="text-center py-10 text-gray-400">
                      Belum ada data untuk periode ini
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => (
                    <tr key={`${s.id_barang}-${i}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500 border border-gray-100">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 border border-gray-100">{s.kode_barang}</td>
                      <td className="px-3 py-2 font-medium text-gray-800 border border-gray-100">{s.nama_barang}</td>
                      <td className="px-3 py-2 text-gray-600 border border-gray-100">{s.merk}</td>
                      <td className="px-3 py-2 text-gray-600 border border-gray-100">{s.satuan}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-700 border border-gray-100">{s.saldo_awal}</td>
                      {s.keluar_per_tanggal.map((qty, d) => (
                        <td
                          key={d}
                          className={`px-1 py-2 text-center border border-gray-100 text-xs ${qty > 0 ? 'text-orange-600 font-medium bg-orange-50' : 'text-gray-200'}`}
                        >
                          {qty > 0 ? qty : ''}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold text-orange-600 border border-gray-100">{s.total_pemakaian}</td>
                      <td className={`px-3 py-2 text-right font-bold border border-gray-100 ${s.sisa_saldo <= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {s.sisa_saldo}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
