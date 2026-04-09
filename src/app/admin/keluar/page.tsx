'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getKeluar, getBarangGrouped, addKeluarBatch, updateKeluar, deleteKeluar, pingAPI, type Keluar, type Barang, type BarangGrouped, type KeluarType } from '@/lib/api'
import Modal from '@/components/Modal'
import SearchableSelect from '@/components/SearchableSelect'
import Toast from '@/components/Toast'

const TYPES: { value: KeluarType; label: string }[] = [
  { value: 'atk', label: 'ATK' },
  { value: 'rt', label: 'Rumah Tangga' },
  { value: 'obat', label: 'Obat' },
]

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

type ItemForm = Omit<Keluar, 'id' | 'sisa_saldo'>
type ItemErrors = Partial<Record<'nama_barang' | 'tanggal' | 'qty', string>>

function makeItem(): ItemForm {
  return {
    id_barang: '',
    kode_barang: '',
    nama_barang: '',
    merk: '',
    satuan: '',
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
  const barangOptions = useMemo(() => barangList.map((b) => ({
    value: b.id,
    label: b.nama_barang,
  })), [barangList])

  const selectedBarang = barangList.find((b) => b.id === item.id_barang)

  function handleBarang(id: string) {
    if (!id) {
      onChange({ id_barang: '', kode_barang: '', nama_barang: '', merk: '', satuan: '' })
      return
    }
    const b = barangList.find((x) => x.id === id)
    if (b) onChange({ id_barang: b.id, kode_barang: b.kode_barang, nama_barang: b.nama_barang, merk: b.merk, satuan: b.satuan })
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
            Barang <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={barangOptions}
            value={item.id_barang}
            onChange={handleBarang}
            placeholder="Pilih barang..."
            ring="orange"
            error={!!errors.nama_barang}
          />
          {errors.nama_barang && <p className="text-red-500 text-xs mt-1">{errors.nama_barang}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Merk</label>
          <input
            type="text"
            value={item.merk}
            disabled
            placeholder="-"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-500 cursor-not-allowed"
          />
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
            Jumlah Keluar <span className="text-red-500">*</span>
          </label>
          <div className={`flex rounded-lg overflow-hidden border ${errors.qty ? 'border-red-400' : 'border-gray-300'} focus-within:ring-2 focus-within:ring-orange-400`}>
            <input
              type="number"
              min={1}
              value={item.qty}
              onChange={(e) => onChange({ qty: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm focus:outline-none bg-white"
            />
            <span className="flex items-center px-3 py-2 text-sm text-gray-500 bg-gray-100 border-l border-gray-300 whitespace-nowrap">
              {item.satuan || '-'}
            </span>
          </div>
          {errors.qty && <p className="text-red-500 text-xs mt-1">{errors.qty}</p>}
          {selectedBarang && (
            <p className="text-xs text-blue-600 mt-1">Sisa stok: {selectedBarang.sisa_saldo}</p>
          )}
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

export default function KeluarPage() {
  const now = new Date()
  const [activeType, setActiveType] = useState<KeluarType>('atk')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [allKeluar, setAllKeluar] = useState<Record<KeluarType, Keluar[]>>({ atk: [], rt: [], obat: [] })
  const [barangGrouped, setBarangGrouped] = useState<BarangGrouped>({ atk: [], rt: [], obat: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [items, setItems] = useState<ItemForm[]>([makeItem()])
  const [itemErrors, setItemErrors] = useState<ItemErrors[]>([{}])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [atkData, rtData, obatData, grouped] = await Promise.all([
        getKeluar('atk', month, year),
        getKeluar('rt', month, year),
        getKeluar('obat', month, year),
        getBarangGrouped(),
      ])
      setAllKeluar({ atk: atkData, rt: rtData, obat: obatData })
      setBarangGrouped(grouped)
    } catch {
      setError('Gagal memuat data.')
    } finally {
      setLoading(false)
    }
  }, [month, year])

  useEffect(() => { setPage(1); load() }, [load])

  // Ping setiap 4 menit untuk mencegah GAS cold start
  useEffect(() => {
    const interval = setInterval(pingAPI, 4 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  function openAdd() {
    setEditId(null)
    setItems([makeItem()])
    setItemErrors([{}])
    setModalOpen(true)
    pingAPI()
  }

  function openEdit(row: Keluar) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, sisa_saldo, ...rest } = row
    setEditId(id)
    setItems([rest])
    setItemErrors([{}])
    setModalOpen(true)
    pingAPI()
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
      if (!it.id_barang) e.nama_barang = 'Pilih barang'
      if (!it.tanggal) e.tanggal = 'Tanggal wajib diisi'
      if (!it.qty || it.qty < 1) e.qty = 'Qty minimal 1'
      return e
    })
    setItemErrors(errors)
    return errors.every((e) => Object.keys(e).length === 0)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) {
      setToast('Harap lengkapi semua field yang wajib diisi.')
      return
    }
    setSaving(true)
    try {
      if (editId) {
        await updateKeluar(activeType, { ...items[0], id: editId })
      } else {
        await addKeluarBatch(activeType, items)
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
      await deleteKeluar(activeType, deleteId)
      setDeleteId(null)
      await load()
    } catch {
      alert('Gagal menghapus data.')
    } finally {
      setSaving(false)
    }
  }

  const PAGE_SIZE = 10

  useEffect(() => { setPage(1) }, [search])

  const data = allKeluar[activeType]
  const filtered = data.filter((d) => {
    const q = search.toLowerCase()
    return (
      d.kode_barang.toLowerCase().includes(q) ||
      d.nama_barang.toLowerCase().includes(q) ||
      d.merk.toLowerCase().includes(q) ||
      d.keterangan.toLowerCase().includes(q)
    )
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Persediaan Keluar</h1>
        <div className="flex gap-2">
          <button onClick={load} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
            🔄 Refresh
          </button>
          <button onClick={openAdd} className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors">
            + Tambah
          </button>
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => { setActiveType(t.value); setSearch('') }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeType === t.value
                ? 'border-orange-500 text-orange-600 bg-orange-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {!loading && (
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {allKeluar[t.value].length}
              </span>
            )}
          </button>
        ))}
      </div>

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

      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="px-4 py-3 border-b">
          <input
            type="text"
            placeholder="Cari kode, nama, merk, atau keterangan..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
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
                  <th className="px-4 py-3 text-left">Tanggal</th>
                  <th className="px-4 py-3 text-right">Jml Keluar</th>
                  <th className="px-4 py-3 text-right">Sisa Saldo</th>
                  <th className="px-4 py-3 text-left">Keterangan</th>
                  <th className="px-4 py-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-10 text-gray-400">Belum ada data</td></tr>
                ) : (
                  paginated.map((row, i) => (
                    <tr key={`${row.id}-${i}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{row.id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.kode_barang}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{row.nama_barang}</td>
                      <td className="px-4 py-3 text-gray-600">{row.merk}</td>
                      <td className="px-4 py-3 text-gray-600">{row.satuan}</td>
                      <td className="px-4 py-3 text-gray-600">{row.tanggal}</td>
                      <td className="px-4 py-3 text-right font-medium text-orange-600">{row.qty}</td>
                      <td className="px-4 py-3 text-right font-medium text-blue-600">{row.sisa_saldo}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-32 truncate">{row.keterangan}</td>
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
              >‹</button>
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
                      className={`px-3 py-1 rounded text-sm border ${currentPage === p ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                    >{p}</button>
                  )
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2 py-1 rounded text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >›</button>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <Modal
          title={editId ? 'Edit Persediaan Keluar' : `Tambah Keluar ${TYPES.find(t => t.value === activeType)?.label}`}
          onClose={() => setModalOpen(false)}
          size="xxl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            {items.map((item, i) => (
              <ItemRow
                key={i}
                index={i}
                item={item}
                barangList={barangGrouped[activeType]}
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
                className="w-full border-2 border-dashed border-gray-300 text-gray-500 rounded-lg py-2.5 text-sm hover:border-orange-400 hover:text-orange-500 transition-colors"
              >
                + Tambah Item
              </button>
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
                disabled={saving}
                className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : editId ? 'Update' : `Simpan${items.length > 1 ? ` (${items.length} item)` : ''}`}
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
      {toast && <Toast message={toast} type="error" onClose={() => setToast('')} />}
    </div>
  )
}

