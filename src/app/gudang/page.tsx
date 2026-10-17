'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { getBarangGrouped, type BarangGrouped, type KeluarType } from '@/lib/api'
import { getAnomali, skorAnomali, TYPE_LABEL, type AnomaliData, type AnomaliItem } from '@/lib/gudang'
import { fmtSelisih } from '@/lib/ledger'
import KartuStok from '@/components/gudang/KartuStok'

type Filter = 'all' | KeluarType

function Badges({ a }: { a: AnomaliItem }) {
  const items: [string, string][] = []
  if (a.loncatan) items.push(['bg-red-50 text-red-700', `Loncatan ×${a.loncatan}`])
  if (a.minus) items.push(['bg-red-50 text-red-700', 'Stok minus'])
  if (a.ujung) items.push(['bg-red-50 text-red-700', `Ujung ≠ G (${fmtSelisih(a.ujung)})`])
  if (a.kembar) items.push(['bg-red-50 text-red-700', 'ID kembar'])
  if (a.terisolasi) items.push(['bg-amber-50 text-amber-800', `Terisolasi ×${a.terisolasi}`])
  if (a.fDrift) items.push(['bg-amber-50 text-amber-800', `F meleset ${fmtSelisih(a.fDrift)}`])
  if (a.snapshot) items.push(['bg-amber-50 text-amber-800', `Snapshot ≠ ×${a.snapshot}`])
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([cls, label]) => (
        <span key={label} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{label}</span>
      ))}
    </div>
  )
}

interface Pilihan { type: KeluarType; id: string }

export default function KontinuitasPage() {
  const [anomali, setAnomali] = useState<AnomaliData | null>(null)
  const [barang, setBarang] = useState<BarangGrouped>({ atk: [], rt: [], obat: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<Pilihan | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      const [a, b] = await Promise.all([getAnomali(), getBarangGrouped({ refresh })])
      setAnomali(a)
      setBarang(b)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Anomali dimuat ulang tanpa memuat ulang daftar barang — dipanggil setelah simpan.
  const reloadAnomali = useCallback(async () => {
    try { setAnomali(await getAnomali()) } catch { /* daftar lama tetap ditampilkan */ }
  }, [])

  const anomaliMap = useMemo(() => {
    const m = new Map<string, AnomaliItem>()
    anomali?.items.forEach((a) => m.set(`${a.type}|${a.id_barang}`, a))
    return m
  }, [anomali])

  const daftar = useMemo(() => {
    const query = q.trim().toLowerCase()
    const types: KeluarType[] = filter === 'all' ? ['atk', 'rt', 'obat'] : [filter]
    if (!query) {
      return (anomali?.items ?? [])
        .filter((a) => types.includes(a.type))
        .sort((x, y) => skorAnomali(y) - skorAnomali(x))
        .map((a) => ({ type: a.type, id: a.id_barang, nama: a.nama_barang, sub: `${a.id_barang} · ${a.merk} · ${a.transaksi} transaksi`, a }))
    }
    return types.flatMap((t) => barang[t]
      .filter((b) => `${b.nama_barang} ${b.kode_barang} ${b.id} ${b.merk}`.toLowerCase().includes(query))
      .map((b) => ({ type: t, id: b.id, nama: b.nama_barang, sub: `${b.id} · ${b.merk}`, a: anomaliMap.get(`${t}|${b.id}`) })))
      .slice(0, 100)
  }, [q, filter, anomali, barang, anomaliMap])

  const jumlah = useMemo(() => {
    const items = anomali?.items ?? []
    return {
      loncatan: items.filter((a) => a.loncatan).length,
      minus: items.filter((a) => a.minus).length,
      ujung: items.filter((a) => a.ujung).length,
      kembar: items.filter((a) => a.kembar).length,
      terisolasi: items.filter((a) => a.terisolasi).length,
      f: items.filter((a) => a.fDrift).length,
      snapshot: items.filter((a) => a.snapshot).length,
    }
  }, [anomali])

  function pilih(p: Pilihan) {
    setSel(p)
    if (window.innerWidth < 1024) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kontinuitas stok</h1>
          <p className="text-sm text-gray-500 mt-1">Barang yang saldonya tidak nyambung. Pilih barang untuk melihat dan memperbaiki riwayatnya.</p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Periksa ulang
        </button>
      </div>

      {error && <div className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</div>}

      {anomali && (
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">{anomali.items.length} dari {anomali.totalBarang} barang perlu dicek</span>
          {jumlah.loncatan > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700">{jumlah.loncatan} loncatan</span>}
          {jumlah.minus > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700">{jumlah.minus} stok minus</span>}
          {jumlah.ujung > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700">{jumlah.ujung} ujung ≠ G</span>}
          {jumlah.kembar > 0 && <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700">{jumlah.kembar} ID kembar</span>}
          {jumlah.terisolasi > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">{jumlah.terisolasi} terisolasi</span>}
          {jumlah.f > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">{jumlah.f} F meleset</span>}
          {jumlah.snapshot > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800">{jumlah.snapshot} snapshot ≠</span>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
        <aside className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] max-h-[420px] overflow-hidden">
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari nama, kode, atau ID barang…"
                aria-label="Cari barang"
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(['all', 'atk', 'rt', 'obat'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1 rounded-full border ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {f === 'all' ? 'Semua' : TYPE_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto p-1.5">
            <div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {q.trim() ? `Hasil cari (${daftar.length})` : `Perlu dicek (${daftar.length})`}
            </div>
            {loading && !anomali && <div className="p-6 text-center text-sm text-gray-400">Memeriksa semua barang…</div>}
            {!loading && daftar.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-400">
                {q.trim() ? 'Tidak ada barang yang cocok.' : 'Semua saldo nyambung. Cari untuk membuka barang mana pun.'}
              </div>
            )}
            {daftar.map((d) => {
              const aktif = sel?.type === d.type && sel.id === d.id
              return (
                <button
                  key={`${d.type}|${d.id}`}
                  onClick={() => pilih({ type: d.type, id: d.id })}
                  className={`w-full text-left rounded-lg px-2.5 py-2 border space-y-1 ${aktif ? 'bg-blue-50 border-blue-400' : 'border-transparent hover:bg-gray-50'}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">{d.nama}</span>
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{TYPE_LABEL[d.type]}</span>
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{d.sub}</div>
                  {d.a && <Badges a={d.a} />}
                </button>
              )
            })}
          </div>
        </aside>

        <div ref={editorRef} className="bg-white rounded-xl border border-gray-200 shadow-sm min-w-0 scroll-mt-20">
          {sel ? (
            <KartuStok key={`${sel.type}|${sel.id}`} type={sel.type} idBarang={sel.id} onSaved={() => void reloadAnomali()} />
          ) : (
            <div className="p-12 text-center text-sm text-gray-400">
              Pilih barang dari daftar, atau cari barang mana pun, untuk membuka kartu stoknya.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
