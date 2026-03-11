'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getBarang, getMasuk, getKeluar, getStokData, type StokItem } from '@/lib/api'

interface Summary {
  totalBarang: number
  totalMasuk: number
  totalKeluar: number
  stokItems: StokItem[]
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [barang, masuk, keluar, stokItems] = await Promise.all([
          getBarang(),
          getMasuk(),
          getKeluar(),
          getStokData(),
        ])
        setSummary({ totalBarang: barang.length, totalMasuk: masuk.length, totalKeluar: keluar.length, stokItems })
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

  const cards = [
    { label: 'Jenis Barang', value: summary!.totalBarang, color: 'bg-blue-600', icon: '📦' },
    { label: 'Transaksi Masuk', value: summary!.totalMasuk, color: 'bg-green-600', icon: '📥' },
    { label: 'Transaksi Keluar', value: summary!.totalKeluar, color: 'bg-orange-500', icon: '📤' },
    { label: 'Item Stok Habis', value: summary!.stokItems.filter((s) => s.stok_akhir <= 0).length, color: 'bg-red-600', icon: '⚠️' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className={`${c.color} text-white rounded-xl p-5 shadow`}>
            <div className="text-3xl mb-2">{c.icon}</div>
            <div className="text-3xl font-bold">{c.value}</div>
            <div className="text-sm opacity-90 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { href: '/barang', label: 'Master Barang', icon: '🗂️' },
          { href: '/masuk', label: 'Persediaan Masuk', icon: '📥' },
          { href: '/keluar', label: 'Persediaan Keluar', icon: '📤' },
          { href: '/stok', label: 'Laporan Stok', icon: '📊' },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="bg-white border border-gray-200 rounded-xl p-4 text-center hover:border-blue-400 hover:shadow-md transition-all">
            <div className="text-2xl mb-1">{l.icon}</div>
            <div className="text-sm font-medium text-gray-700">{l.label}</div>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Ringkasan Stok</h2>
          <Link href="/stok" className="text-sm text-blue-600 hover:underline">Lihat semua →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Kode</th>
                <th className="px-4 py-3 text-left">Nama Barang</th>
                <th className="px-4 py-3 text-left">Merk</th>
                <th className="px-4 py-3 text-left">UOM</th>
                <th className="px-4 py-3 text-right">Masuk</th>
                <th className="px-4 py-3 text-right">Keluar</th>
                <th className="px-4 py-3 text-right">Stok Akhir</th>
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
                    <td className="px-4 py-3 text-gray-600">{s.uom}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{s.total_masuk}</td>
                    <td className="px-4 py-3 text-right text-orange-500 font-medium">{s.total_keluar}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">{s.stok_akhir}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.stok_akhir <= 0 ? 'bg-red-100 text-red-700' : s.stok_akhir <= 5 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                        {s.stok_akhir <= 0 ? 'Habis' : s.stok_akhir <= 5 ? 'Rendah' : 'Aman'}
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
