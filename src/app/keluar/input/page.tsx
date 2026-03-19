'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getBarang, addKeluar, type Barang, type Keluar } from '@/lib/api'
import SearchableSelect from '@/components/SearchableSelect'

type ItemForm = Omit<Keluar, 'id'>
type ItemErrors = Partial<Record<'nama_barang' | 'merk' | 'tanggal' | 'qty', string>>

function makeItem(): ItemForm {
  return {
    id_barang: '',
    kode_barang: '',
    nama_barang: '',
    merk: '',
    uom: '',
    tanggal: new Date().toISOString().split('T')[0],
    qty: 1,
    keterangan: '',
  }
}

// ─── Item Row ─────────────────────────────────────────────────────────────────

interface ItemRowProps {
  index: number
  item: ItemForm
  barangList: Barang[]
  onChange: (updates: Partial<ItemForm>) => void
  onRemove: () => void
  canRemove: boolean
  errors: ItemErrors
}

function ItemRow({ index, item, barangList, onChange, onRemove, canRemove, errors }: ItemRowProps) {
  const namaOptions = [...new Map(
    barangList.map((b) => [b.nama_barang, { value: b.nama_barang, label: b.nama_barang }])
  ).values()]

  const merkOptions = barangList
    .filter((b) => b.nama_barang === item.nama_barang)
    .reduce<{ value: string; label: string }[]>((acc, b) => {
      if (!acc.find((x) => x.value === b.merk)) acc.push({ value: b.merk, label: b.merk })
      return acc
    }, [])

  function handleNama(nama: string) {
    onChange({ nama_barang: nama, merk: '', id_barang: '', kode_barang: '', uom: '' })
  }

  function handleMerk(merk: string) {
    if (!merk) { onChange({ merk: '', id_barang: '', kode_barang: '', uom: '' }); return }
    const b = barangList.find((x) => x.nama_barang === item.nama_barang && x.merk === merk)
    if (b) onChange({ merk, id_barang: b.id, kode_barang: b.kode_barang, uom: b.uom })
    else onChange({ merk })
  }

  return (
    <div className={`bg-gray-50 rounded-lg p-4 border ${Object.keys(errors).length ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Item #{index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-0.5 rounded transition-colors"
          >
            Hapus
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-start">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Nama Barang <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={namaOptions}
            value={item.nama_barang}
            onChange={handleNama}
            placeholder="Pilih nama..."
            ring="orange"
            error={!!errors.nama_barang}
          />
          {errors.nama_barang && <p className="text-red-500 text-xs mt-1">{errors.nama_barang}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Merk <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={merkOptions}
            value={item.merk}
            onChange={handleMerk}
            placeholder="Pilih merk..."
            disabled={!item.nama_barang}
            ring="orange"
            error={!!errors.merk}
          />
          {errors.merk && <p className="text-red-500 text-xs mt-1">{errors.merk}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Tanggal <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={item.tanggal}
            onChange={(e) => onChange({ tanggal: e.target.value })}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${errors.tanggal ? 'border-red-400' : 'border-gray-300'}`}
          />
          {errors.tanggal && <p className="text-red-500 text-xs mt-1">{errors.tanggal}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Qty <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={item.qty}
              onChange={(e) => onChange({ qty: Number(e.target.value) })}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${errors.qty ? 'border-red-400' : 'border-gray-300'}`}
            />
            <span className="text-xs text-gray-600 bg-gray-200 px-2 py-2 rounded whitespace-nowrap min-w-[2.5rem] text-center">
              {item.uom || '-'}
            </span>
          </div>
          {errors.qty && <p className="text-red-500 text-xs mt-1">{errors.qty}</p>}
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Keterangan</label>
        <input
          type="text"
          value={item.keterangan}
          onChange={(e) => onChange({ keterangan: e.target.value })}
          placeholder="Opsional"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function KeluarInputPage() {
  const [barangList, setBarangList] = useState<Barang[]>([])
  const [barangLoading, setBarangLoading] = useState(true)
  const [items, setItems] = useState<ItemForm[]>([makeItem()])
  const [itemErrors, setItemErrors] = useState<ItemErrors[]>([{}])
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    const cached = sessionStorage.getItem('barangCache')
    if (cached) {
      setBarangList(JSON.parse(cached))
      setBarangLoading(false)
    } else {
      getBarang()
        .then(setBarangList)
        .finally(() => setBarangLoading(false))
    }
  }, [])

  function updateItem(index: number, updates: Partial<ItemForm>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...updates } : it)))
    setItemErrors((prev) => prev.map((e, i) => (i === index ? { ...e, ...Object.fromEntries(Object.keys(updates).map((k) => [k, undefined])) } : e)))
  }

  function addItem() {
    setItems((prev) => [...prev, makeItem()])
    setItemErrors((prev) => [...prev, {}])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
    setItemErrors((prev) => prev.filter((_, i) => i !== index))
  }

  function validate(): boolean {
    let valid = true
    const newErrors: ItemErrors[] = items.map((item) => {
      const err: ItemErrors = {}
      if (!item.nama_barang) { err.nama_barang = 'Nama barang wajib diisi'; valid = false }
      if (!item.merk) { err.merk = 'Merk wajib diisi'; valid = false }
      if (!item.tanggal) { err.tanggal = 'Tanggal wajib diisi'; valid = false }
      if (!item.qty || item.qty < 1) { err.qty = 'Qty minimal 1'; valid = false }
      return err
    })
    setItemErrors(newErrors)
    return valid
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    setSubmitError('')
    try {
      for (const item of items) {
        await addKeluar(item)
      }
      setSuccess(true)
    } catch {
      setSubmitError('Gagal menyimpan data. Periksa koneksi dan coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setItems([makeItem()])
    setItemErrors([{}])
    setSuccess(false)
    setSubmitError('')
  }

  if (success) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center border border-gray-200">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Berhasil Disimpan!</h2>
          <p className="text-gray-500 text-sm mb-6">
            {items.length > 1 ? `${items.length} item` : '1 item'} persediaan keluar telah disimpan.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleReset}
              className="w-full bg-orange-500 text-white py-2.5 rounded-xl font-medium hover:bg-orange-600 transition-colors"
            >
              Input Lagi
            </button>
            <Link
              href="/keluar"
              className="w-full border border-gray-300 text-gray-700 py-2.5 rounded-xl font-medium hover:bg-gray-50 transition-colors text-center"
            >
              ← Kembali ke Daftar
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Form Persediaan Keluar</h1>
        </div>
        <Link href="/keluar" className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          ← Kembali
        </Link>
      </div>

        {barangLoading ? (
          <div className="bg-white rounded-2xl shadow p-10 flex items-center justify-center gap-3 text-gray-500 text-sm">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500" />
            Memuat data barang...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {items.map((item, i) => (
              <ItemRow
                key={i}
                index={i}
                item={item}
                barangList={barangList}
                onChange={(updates) => updateItem(i, updates)}
                onRemove={() => removeItem(i)}
                canRemove={items.length > 1}
                errors={itemErrors[i] ?? {}}
              />
            ))}

            <button
              type="button"
              onClick={addItem}
              className="w-full border-2 border-dashed border-orange-300 text-orange-500 rounded-xl py-3 text-sm font-medium hover:border-orange-400 hover:bg-orange-50 transition-colors"
            >
              + Tambah Item
            </button>

            {submitError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange-500 text-white py-3 rounded-xl font-semibold text-base hover:bg-orange-600 disabled:opacity-50 transition-colors shadow-sm"
            >
              {saving ? 'Menyimpan...' : `Simpan${items.length > 1 ? ` (${items.length} item)` : ''}`}
            </button>
          </form>
      )}
    </div>
  )
}
