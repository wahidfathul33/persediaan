'use client'

import { useCallback, useEffect, useState } from 'react'
import { getMasuk, getBarang, addMasuk, updateMasuk, deleteMasuk, type Masuk, type Barang } from '@/lib/api'
import Modal from '@/components/Modal'
import SearchableSelect from '@/components/SearchableSelect'

type ItemForm = Omit<Masuk, 'id'>
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
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.tanggal ? 'border-red-400' : 'border-gray-300'}`}
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
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.qty ? 'border-red-400' : 'border-gray-300'}`}
            />
            <span className="text-xs text-gray-600 bg-gray-200 px-2 py-2 rounded whitespace-nowrap min-w-[2.5rem] text-center">
              {item.uom || '-'}
            </span>
          </div>
          {errors.qty && <p className="text-red-500 text-xs mt-1">{errors.qty}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MasukPage() {
  const [data, setData] = useState<Masuk[]>([])
  const [barangList, setBarangList] = useState<Barang[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [items, setItems] = useState<ItemForm[]>([makeItem()])
  const [itemErrors, setItemErrors] = useState<ItemErrors[]>([{}])
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [masuk, barang] = await Promise.all([getMasuk(), getBarang()])
      setData(masuk)
      setBarangList(barang)
    } catch {
      setError('Gagal memuat data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditId(null)
    setItems([makeItem()])
    setItemErrors([{}])
    setModalOpen(true)
  }

  function openEdit(row: Masuk) {
    const { id, ...rest } = row
    setEditId(id)
    setItems([rest])
    setItemErrors([{}])
    setModalOpen(true)
  }

  function updateItem(index: number, updates: Partial<ItemForm>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...updates } : it)))
    setItemErrors((prev) => prev.map((err, i) => {
      if (i !== index) return err
      const next = { ...err }
      ;(Object.keys(updates) as (keyof ItemErrors)[]).forEach((k) => delete next[k])
      return next
    }))
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
    const errors = items.map((it) => {
      const e: ItemErrors = {}
      if (!it.nama_barang) e.nama_barang = 'Pilih nama barang'
      if (!it.merk) e.merk = 'Pilih merk'
      if (!it.tanggal) e.tanggal = 'Tanggal wajib diisi'
      if (!it.qty || it.qty < 1) e.qty = 'Qty minimal 1'
      return e
    })
    setItemErrors(errors)
    return errors.every((e) => Object.keys(e).length === 0)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      if (editId) {
        await updateMasuk({ ...items[0], id: editId })
      } else {
        for (const item of items) {
          await addMasuk(item)
        }
      }
      setModalOpen(false)
      await load()
    } catch {
      alert('Gagal menyimpan data.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await deleteMasuk(deleteId)
      setDeleteId(null)
      await load()
    } catch {
      alert('Gagal menghapus data.')
    } finally {
      setSaving(false)
    }
  }

  const PAGE_SIZE = 10
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [search])

  const filtered = data.filter((d) => {
    const q = search.toLowerCase()
    return (
      d.kode_barang.toLowerCase().includes(q) ||
      d.nama_barang.toLowerCase().includes(q) ||
      d.merk.toLowerCase().includes(q)
    )
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Persediaan Masuk</h1>
        <div className="flex gap-2">
          <button onClick={load} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
            🔄 Refresh
          </button>
          <button onClick={openAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            + Tambah
          </button>
        </div>
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
                  <th className="px-4 py-3 text-left">ID Barang</th>
                  <th className="px-4 py-3 text-left">Kode Barang</th>
                  <th className="px-4 py-3 text-left">Nama Barang</th>
                  <th className="px-4 py-3 text-left">Merk</th>
                  <th className="px-4 py-3 text-left">UOM</th>
                  <th className="px-4 py-3 text-left">Tanggal</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-10 text-gray-400">Belum ada data</td></tr>
                ) : (
                  paginated.map((row, i) => (
                    <tr key={`${row.id}-${i}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{row.id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{row.id_barang}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.kode_barang}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{row.nama_barang}</td>
                      <td className="px-4 py-3 text-gray-600">{row.merk}</td>
                      <td className="px-4 py-3 text-gray-600">{row.uom}</td>
                      <td className="px-4 py-3 text-gray-600">{row.tanggal}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">{row.qty}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => openEdit(row)} className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                          <button onClick={() => setDeleteId(row.id)} className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50">Hapus</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-gray-500">
            Menampilkan {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} dari {filtered.length} transaksi
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

      {/* Add/Edit Modal */}
      {modalOpen && (
        <Modal
          title={editId ? 'Edit Persediaan Masuk' : 'Tambah Persediaan Masuk'}
          onClose={() => setModalOpen(false)}
          size="xxl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            {loading && barangList.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-gray-500 text-sm gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                Memuat data barang...
              </div>
            ) : (
              <>
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
                {!editId && (
                  <button
                    type="button"
                    onClick={addItem}
                    className="w-full border-2 border-dashed border-gray-300 text-gray-500 rounded-lg py-2.5 text-sm hover:border-blue-400 hover:text-blue-600 transition-colors"
                  >
                    + Tambah Item
                  </button>
                )}
              </>
            )}

            <div className="flex gap-2 justify-end pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || (loading && barangList.length === 0)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving
                  ? 'Menyimpan...'
                  : editId
                  ? 'Update'
                  : `Simpan${items.length > 1 ? ` (${items.length} item)` : ''}`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {deleteId && (
        <Modal title="Konfirmasi Hapus" onClose={() => setDeleteId(null)}>
          <p className="text-gray-700 mb-6">Yakin ingin menghapus data ini?</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setDeleteId(null)} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
              Batal
            </button>
            <button onClick={handleDelete} disabled={saving} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
              {saving ? 'Menghapus...' : 'Hapus'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
