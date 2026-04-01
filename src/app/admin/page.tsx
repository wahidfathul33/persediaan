'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getBarang, getKeluar, getStokData, type StokItem } from '@/lib/api'

interface Summary {
  totalBarang: number
  totalKeluar: number
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
        const [barang, atk, rt, obat, stokItems] = await Promise.all([
          getBarang(),
          getKeluar('atk', month, year),
          getKeluar('rt', month, year),
          getKeluar('obat', month, year),
          getStokData(month, year),
        ])
        const totalKeluar = atk.length + rt.length + obat.length
        setSummary({ totalBarang: barang.length, totalKeluar, stokItems })
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

  const stokHabis = summary!.stokItems.filter((s) => s.sisa_saldo <= 0).length

  const cards = [
    { label: 'Jenis Barang', value: summary!.totalBarang, color: 'bg-blue-600', icon: '📦' },
    { label: 'Keluar Bulan Ini', value: summary!.totalKeluar, color: 'bg-orange-500', icon: '📤' },
    { label: 'Stok Habis', value: stokHabis, color: 'bg-red-600', icon: '⚠️' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className={`${c.color} text-white rounded-xl p-5 shadow`}>
            <div className="text-3xl mb-2">{c.icon}</div>
            <div className="text-3xl font-bold">{c.value}</div>
            <div className="text-sm opacity-90 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {[
          { href: '/admin/barang', label: 'Master Barang', icon: '🗂️' },
          { href: '/admin/keluar', label: 'Persediaan Keluar', icon: '📤' },
          { href: '/admin/stok', label: 'Laporan Stok', icon: '📊' },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="bg-white border border-gray-200 rounded-xl p-4 text-center hover:border-blue-400 hover:shadow-md transition-all">
            <div className="text-2xl mb-1">{l.icon}</div>
            <div className="text-sm font-medium text-gray-700">{l.label}</div>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Ringkasan Stok Bulan Ini</h2>
          <Link href="/admin/stok" className="text-sm text-blue-600 hover:underline">Lihat semua →</Link>
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
              {summary!.stokItems.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Belum ada data stok</td></tr>
              ) : (
                summary!.stokItems.slice(0, 10).map((s) => (
                  <tr key={s.kode_barang} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.kode_barang}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{s.nama_barang}</td>
                    <td className="px-4 py-3 text-gray-600">{s.merk}</td>
                    <td className="px-4 py-3 text-gray-600">{s.satuan}</td>
                    <td className="px-4 py-3 text-right text-gray-700 font-medium">{s.saldo_awal}</td>
                    <td className="px-4 py-3 text-right text-orange-500 font-medium">{s.total_pemakaian}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">{s.sisa_saldo}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.sisa_saldo <= 0 ? 'bg-red-100 text-red-700' : s.sisa_saldo <= 5 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                        {s.sisa_saldo <= 0 ? 'Habis' : s.sisa_saldo <= 5 ? 'Rendah' : 'Aman'}
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


