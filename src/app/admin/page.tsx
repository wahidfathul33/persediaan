'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Package, PackagePlus, PackageMinus, BarChart3, AlertTriangle, XCircle, ChevronRight } from 'lucide-react'
import { getBarangGrouped, getKeluar, getMasuk, getStokData, type StokItem } from '@/lib/api'

interface Summary {
  totalBarang: number
  totalKeluar: number
  totalMasuk: number
  stokHabis: number
  stokRendah: number
  stokItems: StokItem[]
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()
      try {
        const [grouped, atkK, rtK, obatK, atkM, rtM, obatM, stokItems] = await Promise.all([
          getBarangGrouped(),
          getKeluar('atk', month, year),
          getKeluar('rt', month, year),
          getKeluar('obat', month, year),
          getMasuk('atk', month, year),
          getMasuk('rt', month, year),
          getMasuk('obat', month, year),
          getStokData(month, year),
        ])
        const totalBarang = grouped.atk.length + grouped.rt.length + grouped.obat.length
        const totalKeluar = atkK.length + rtK.length + obatK.length
        const totalMasuk  = atkM.length + rtM.length + obatM.length
        const stokHabis   = stokItems.filter((s) => s.sisa_saldo <= 0).length
        const stokRendah  = stokItems.filter((s) => s.sisa_saldo > 0 && s.sisa_saldo <= 5).length
        setSummary({ totalBarang, totalKeluar, totalMasuk, stokHabis, stokRendah, stokItems })
      } catch {
        setError('Gagal memuat data. Pastikan URL API sudah benar di .env.local')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    )

  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
        <p className="font-semibold">⚠ Terjadi Kesalahan</p>
        <p className="mt-1 text-sm">{error}</p>
        <p className="mt-2 text-sm">
          Edit file <code className="bg-red-100 px-1 rounded">.env.local</code> dan isi{' '}
          <code className="bg-red-100 px-1 rounded">NEXT_PUBLIC_API_URL</code> dengan URL Google Apps Script Anda.
        </p>
      </div>
    )

  const s = summary!

  const cards = [
    { label: 'Jenis Barang',      value: s.totalBarang, color: 'bg-blue-600',   icon: Package,       href: '/admin/barang' },
    { label: 'Masuk Bulan Ini',   value: s.totalMasuk,  color: 'bg-green-600',  icon: PackagePlus,   href: '/admin/masuk' },
    { label: 'Keluar Bulan Ini',  value: s.totalKeluar, color: 'bg-orange-500', icon: PackageMinus,  href: '/admin/keluar' },
    { label: 'Stok Habis',        value: s.stokHabis,   color: 'bg-red-500',    icon: XCircle,       href: '/admin/stok' },
    { label: 'Stok Rendah',       value: s.stokRendah,  color: 'bg-amber-500',  icon: AlertTriangle, href: '/admin/stok' },
  ]

  const quickLinks = [
    { href: '/admin/barang', label: 'Master Barang',     icon: Package },
    { href: '/admin/masuk',  label: 'Persediaan Masuk',  icon: PackagePlus },
    { href: '/admin/keluar', label: 'Persediaan Keluar', icon: PackageMinus },
    { href: '/admin/stok',   label: 'Laporan Stok',      icon: BarChart3 },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <Link
              key={c.label}
              href={c.href}
              className={`${c.color} text-white rounded-2xl p-5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all`}
            >
              <Icon size={24} className="mb-3 opacity-90" />
              <div className="text-3xl font-bold">{c.value}</div>
              <div className="text-sm opacity-85 mt-1 font-medium">{c.label}</div>
            </Link>
          )
        })}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {quickLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <div className="bg-blue-50 text-blue-600 p-2 rounded-lg group-hover:bg-blue-100 transition-colors">
              <Icon size={18} />
            </div>
            <span className="text-sm font-medium text-gray-700">{label}</span>
          </Link>
        ))}
      </div>

      {/* Stock table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Ringkasan Stok Bulan Ini</h2>
          <Link href="/admin/stok" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            Lihat semua <ChevronRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Kode</th>
                <th className="px-4 py-3 text-left">Nama Barang</th>
                <th className="px-4 py-3 text-left">Merk</th>
                <th className="px-4 py-3 text-left">Satuan</th>
                <th className="px-4 py-3 text-right">Saldo Awal</th>
                <th className="px-4 py-3 text-right">Pemakaian</th>
                <th className="px-4 py-3 text-right">Sisa Saldo</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {s.stokItems.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Belum ada data stok</td></tr>
              ) : (
                s.stokItems.slice(0, 10).map((item) => (
                  <tr key={item.id_barang} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.kode_barang}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{item.nama_barang}</td>
                    <td className="px-4 py-3 text-gray-600">{item.merk}</td>
                    <td className="px-4 py-3 text-gray-600">{item.satuan}</td>
                    <td className="px-4 py-3 text-right text-gray-700 font-medium">{item.saldo_awal}</td>
                    <td className="px-4 py-3 text-right text-orange-500 font-medium">{item.total_pemakaian}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">{item.sisa_saldo}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.sisa_saldo <= 0
                          ? 'bg-red-100 text-red-700'
                          : item.sisa_saldo <= 5
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {item.sisa_saldo <= 0 ? 'Habis' : item.sisa_saldo <= 5 ? 'Rendah' : 'Aman'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

