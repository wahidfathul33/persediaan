'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { RefreshCw, Download } from 'lucide-react'
import { getStokData, getBarangGrouped, type StokItem, type KeluarType } from '@/lib/api'

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

const TABS: { value: KeluarType; label: string }[] = [
  { value: 'atk', label: 'ATK' },
  { value: 'rt', label: 'Rumah Tangga' },
  { value: 'obat', label: 'Obat' },
]

export default function StokPage() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [activeTab, setActiveTab] = useState<KeluarType>('atk')
  const [data, setData] = useState<StokItem[]>([])
  const [typeMap, setTypeMap] = useState<Map<string, KeluarType>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [stok, grouped] = await Promise.all([
        getStokData(month, year),
        getBarangGrouped(),
      ])
      setData(stok)
      const map = new Map<string, KeluarType>()
      ;(['atk', 'rt', 'obat'] as KeluarType[]).forEach((t) => {
        grouped[t].forEach((b) => map.set(b.id, t))
      })
      setTypeMap(map)
    } catch {
      setError('Gagal memuat data stok.')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [month, year])

  const tabData = data.filter((s) => typeMap.get(s.id_barang) === activeTab)

  const q = search.toLowerCase()
  const filtered = tabData.filter(
    (s) =>
      String(s.kode_barang ?? '').toLowerCase().includes(q) ||
      String(s.nama_barang ?? '').toLowerCase().includes(q) ||
      String(s.merk ?? '').toLowerCase().includes(q)
  )

  const daysInMonth = tabData[0]?.days_in_month ?? data[0]?.days_in_month ?? 30
  const totalPemakaian = filtered.reduce((sum, s) => sum + s.total_pemakaian, 0)
  const habis = filtered.filter((s) => s.sisa_saldo <= 0).length
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear()

  function downloadExcel() {
    const tabLabel = TABS.find((t) => t.value === activeTab)?.label ?? activeTab.toUpperCase()
    const periodLabel = `${MONTHS[month - 1]} ${year}`
    const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => String(i + 1))
    const headers = ['No', 'Kode', 'Nama Barang', 'Merk', 'Satuan', 'Saldo Awal', ...dayHeaders, 'Total Pakai', 'Sisa Saldo']
    const rows = filtered.map((s, i) => [
      i + 1,
      s.kode_barang,
      s.nama_barang,
      s.merk,
      s.satuan,
      s.saldo_awal,
      ...s.keluar_per_tanggal,
      s.total_pemakaian,
      s.sisa_saldo,
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [
      { wch: 4 }, { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 8 }, { wch: 10 },
      ...Array.from({ length: daysInMonth }, () => ({ wch: 4 })),
      { wch: 12 }, { wch: 10 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Stok ${tabLabel}`)
    XLSX.writeFile(wb, `Laporan_Stok_${tabLabel}_${periodLabel.replace(' ', '_')}.xlsx`)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Laporan Stok</h1>
        <button onClick={load} className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors">
          <RefreshCw size={14} /> Refresh
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
                {data.filter((s) => typeMap.get(s.id_barang) === t.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Month/year picker */}
      <div className="mb-4">
        <div className="inline-flex items-center gap-0 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
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
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <input
            type="text"
            placeholder="Cari kode, nama, atau merk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={downloadExcel}
            disabled={loading || filtered.length === 0}
            className="shrink-0 flex items-center gap-1.5 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={15} /> Download Excel
          </button>
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
                  {isCurrentMonth && <th className="px-3 py-3 text-right border border-gray-200 min-w-[70px]">Saldo Awal</th>}
                  {Array.from({ length: daysInMonth }, (_, i) => (
                    <th key={i} className="px-1 py-3 text-center border border-gray-200 min-w-[30px]">{i + 1}</th>
                  ))}
                  <th className="px-3 py-3 text-right border border-gray-200 min-w-[90px] text-orange-600">Total Pakai</th>
                  {isCurrentMonth && <th className="px-3 py-3 text-right border border-gray-200 min-w-[80px] text-blue-600">Sisa Saldo</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={(isCurrentMonth ? 6 : 4) + daysInMonth + (isCurrentMonth ? 2 : 1)} className="text-center py-10 text-gray-400">
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
                      {isCurrentMonth && <td className="px-3 py-2 text-right font-medium text-gray-700 border border-gray-100">{s.saldo_awal}</td>}
                      {s.keluar_per_tanggal.map((qty, d) => (
                        <td
                          key={d}
                          className={`px-1 py-2 text-center border border-gray-100 text-xs ${qty > 0 ? 'text-orange-600 font-medium bg-orange-50' : 'text-gray-200'}`}
                        >
                          {qty > 0 ? qty : ''}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold text-orange-600 border border-gray-100">{s.total_pemakaian}</td>
                      {isCurrentMonth && (
                        <td className={`px-3 py-2 text-right font-bold border border-gray-100 ${s.sisa_saldo <= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {s.sisa_saldo}
                        </td>
                      )}
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
