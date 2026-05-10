'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Plus } from 'lucide-react'
import { getBarangGrouped, addBarang, updateBarang, deleteBarang, pingAPI, type Barang, type BarangGrouped, type KeluarType } from '@/lib/api'
import Modal from '@/components/Modal'
import Toast from '@/components/Toast'

const PAGE_SIZE = 10

const TABS: { value: KeluarType; label: string }[] = [
  { value: 'atk', label: 'ATK' },
  { value: 'rt', label: 'Rumah Tangga' },
  { value: 'obat', label: 'Obat' },
]

type BarangForm = Omit<Barang, 'id' | 'sisa_saldo'>
type BarangErrors = Partial<Record<'kode_barang' | 'nama_barang' | 'merk' | 'satuan' | 'saldo_awal', string>>

function makeForm(): BarangForm {
  return { kode_barang: '', nama_barang: '', merk: '', satuan: '', saldo_awal: 0 }
}

export default function BarangPage() {
  const [grouped, setGrouped] = useState<BarangGrouped>({ atk: [], rt: [], obat: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<KeluarType>('atk')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<BarangForm>(makeForm())
  const [formErrors, setFormErrors] = useState<BarangErrors>({})
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

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

  useEffect(() => {
    const interval = setInterval(pingAPI, 4 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  function openAdd() {
    setEditId(null)
    setForm(makeForm())
    setFormErrors({})
    setModalOpen(true)
    pingAPI()
  }

  function openEdit(b: Barang) {
    setEditId(b.id)
    setForm({ kode_barang: b.kode_barang, nama_barang: b.nama_barang, merk: b.merk, satuan: b.satuan, saldo_awal: b.saldo_awal })
    setFormErrors({})
    setModalOpen(true)
    pingAPI()
  }

  function validate(): boolean {
    const e: BarangErrors = {}
    if (!form.kode_barang.trim()) e.kode_barang = 'Kode barang wajib diisi'
    if (!form.nama_barang.trim()) e.nama_barang = 'Nama barang wajib diisi'
    if (!form.merk.trim()) e.merk = 'Merk wajib diisi'
    if (!form.satuan.trim()) e.satuan = 'Satuan wajib diisi'
    if (form.saldo_awal < 0) e.saldo_awal = 'Saldo awal tidak boleh negatif'
    setFormErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      if (editId) {
        const existing = grouped[activeTab].find(b => b.id === editId)!
        await updateBarang(activeTab, { ...form, id: editId, sisa_saldo: existing.sisa_saldo })
      } else {
        await addBarang(activeTab, form)
      }
      setModalOpen(false)
      await load()
    } catch {
      setToast('Gagal menyimpan data.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setSaving(true)
    try {
      await deleteBarang(activeTab, deleteId)
      setDeleteId(null)
      await load()
    } catch {
      setToast('Gagal menghapus data.')
    } finally {
      setSaving(false)
    }
  }

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
        <h1 className="text-2xl font-bold text-gray-900">Master Barang</h1>
        <button
          onClick={load}
          className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
        >
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
                {grouped[t.value].length}
              </span>
            )}
          </button>
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
            onClick={openAdd}
            className="shrink-0 flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={15} /> Tambah Barang
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
                  <th className="px-4 py-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-gray-400">
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
                      <td className="px-4 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => openEdit(b)} className="text-blue-600 hover:text-blue-800 text-xs px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                          <button onClick={() => setDeleteId(b.id)} className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50">Hapus</button>
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

      {/* Add/Edit Modal */}
      {modalOpen && (
        <Modal
          title={editId ? `Edit Barang ${TABS.find(t => t.value === activeTab)?.label}` : `Tambah Barang ${TABS.find(t => t.value === activeTab)?.label}`}
          onClose={() => setModalOpen(false)}
          size="lg"
          footer={
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="submit"
                form="barang-modal-form"
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : editId ? 'Update' : 'Simpan'}
              </button>
            </div>
          }
        >
          <form id="barang-modal-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Kode Barang <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.kode_barang}
                  onChange={(e) => setForm((f) => ({ ...f, kode_barang: e.target.value }))}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.kode_barang ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="Contoh: ATK-001"
                />
                {formErrors.kode_barang && <p className="text-red-500 text-xs mt-1">{formErrors.kode_barang}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Nama Barang <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.nama_barang}
                  onChange={(e) => setForm((f) => ({ ...f, nama_barang: e.target.value }))}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.nama_barang ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="Nama barang"
                />
                {formErrors.nama_barang && <p className="text-red-500 text-xs mt-1">{formErrors.nama_barang}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Merk <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.merk}
                  onChange={(e) => setForm((f) => ({ ...f, merk: e.target.value }))}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.merk ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="Merk / tipe"
                />
                {formErrors.merk && <p className="text-red-500 text-xs mt-1">{formErrors.merk}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Satuan <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.satuan}
                  onChange={(e) => setForm((f) => ({ ...f, satuan: e.target.value }))}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.satuan ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="Pcs, Rim, Botol, ..."
                />
                {formErrors.satuan && <p className="text-red-500 text-xs mt-1">{formErrors.satuan}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Saldo Awal <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.saldo_awal}
                  onChange={(e) => setForm((f) => ({ ...f, saldo_awal: Number(e.target.value) }))}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors.saldo_awal ? 'border-red-400' : 'border-gray-300'}`}
                />
                {formErrors.saldo_awal && <p className="text-red-500 text-xs mt-1">{formErrors.saldo_awal}</p>}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {deleteId && (
        <Modal title="Konfirmasi Hapus" onClose={() => setDeleteId(null)}>
          <p className="text-gray-700 mb-6">Yakin ingin menghapus data barang ini? Tindakan ini tidak dapat dibatalkan.</p>
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

