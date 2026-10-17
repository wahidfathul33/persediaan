'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Plus } from 'lucide-react'
import Modal from '@/components/Modal'
import type { KeluarType } from '@/lib/api'
import {
  getKartu, simpanKartu, GudangError, TYPE_LABEL,
  type KartuData, type SimpanKartuPayload,
} from '@/lib/gudang'
import {
  computeLedger, patahanTersimpan, cmpRow, effOf, ymOf, ymLabel, ymShort, nextYm,
  lastDayBefore, fmtTanggal, fmtAngka, fmtSelisih,
  type Kind, type LedgerRow,
} from '@/lib/ledger'

interface DraftRow extends LedgerRow {
  isNew: boolean
  kembar: boolean
  /** Saldo tersimpan di kolom I. null untuk baris baru. */
  saldo0: number | null
  orig: { tanggal: string; qty: number } | null
  keterangan: string
  /** Penanda baris penyesuaian, supaya mengubah angka yang sama tidak menumpuk baris. */
  adj?: string
}

const TGL_RE = /^\d{4}-\d{2}-\d{2}$/
const beda = (a: number, b: number) => Math.abs(a - b) > 1e-9

function isEdited(r: DraftRow) {
  return !r.isNew && !r.deleted && r.orig !== null && (r.tanggal !== r.orig.tanggal || r.qty !== r.orig.qty)
}

/**
 * Input yang baru menerapkan nilai saat Enter atau keluar dari kotak.
 * Mengubah tanggal langsung saat diketik akan membuat baris berpindah posisi
 * di tengah pengetikan, jadi semua kotak di tabel memakai pola ini.
 */
function CommitInput({
  value, onCommit, type = 'number', className = '', disabled, max, label, invalid,
}: {
  value: string | number
  onCommit: (text: string) => void
  type?: 'number' | 'date'
  className?: string
  disabled?: boolean
  max?: string
  label: string
  invalid?: boolean
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  const batal = useRef(false)

  return (
    <input
      type={type}
      aria-label={label}
      value={focused ? text : String(value)}
      disabled={disabled}
      max={max}
      onFocus={() => { setFocused(true); setText(String(value)) }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (batal.current) { batal.current = false; return }
        if (text !== String(value)) onCommit(text)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { batal.current = true; (e.target as HTMLInputElement).blur() }
      }}
      className={`border rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-transparent disabled:border-transparent ${
        invalid ? 'border-red-400' : 'border-gray-200 hover:border-gray-300'
      } ${type === 'number' ? 'text-right tabular-nums' : ''} ${className}`}
    />
  )
}

function KindTag({ kind }: { kind: Kind }) {
  return kind === 'masuk'
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Masuk</span>
    : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">Keluar</span>
}

function Tag({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'blue' | 'gray'; children: React.ReactNode }) {
  const cls = {
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-800',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
  }[tone]
  return <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>
}

export default function KartuStok({ type, idBarang, onSaved }: { type: KeluarType; idBarang: string; onSaved: () => void }) {
  const [kartu, setKartu] = useState<KartuData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [pembuka, setPembuka] = useState(0)
  const [pembuka0, setPembuka0] = useState(0)
  const [newRow, setNewRow] = useState<{ kind: Kind; tanggal: string; qty: string }>({ kind: 'keluar', tanggal: '', qty: '1' })
  const [review, setReview] = useState(false)
  const [alasan, setAlasan] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<{ message: string; stale: boolean } | null>(null)
  const [notice, setNotice] = useState('')
  const seqRef = useRef(0)
  const reqRef = useRef(0)

  const load = useCallback(async () => {
    const req = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const k = await getKartu(type, idBarang)
      if (req !== reqRef.current) return
      const first = k.tx[0]
      const awal = first ? first.saldo - effOf(first) : k.barang.sisa_saldo
      setKartu(k)
      setRows(k.tx.map((t, i) => ({
        uid: `t${i}`, id: t.id, kind: t.kind, tanggal: t.tanggal, qty: t.qty,
        isNew: false, kembar: t.kembar, saldo0: t.saldo, orig: { tanggal: t.tanggal, qty: t.qty }, keterangan: t.keterangan,
      })))
      setPembuka(awal)
      setPembuka0(awal)
      setNewRow({ kind: 'keluar', tanggal: k.today, qty: '1' })
    } catch (err) {
      if (req !== reqRef.current) return
      setError(err instanceof Error ? err.message : 'Gagal memuat kartu stok.')
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [type, idBarang])

  useEffect(() => { void load() }, [load])

  const calc = useMemo(() => (kartu ? computeLedger(rows, pembuka, kartu.nowYm) : null), [kartu, rows, pembuka])

  // Patahan pada data TERSIMPAN — penanda ini tidak ikut berubah saat diedit.
  const patahan = useMemo(
    () => (kartu ? patahanTersimpan(kartu.tx.map((t, i) => ({ uid: `t${i}`, kind: t.kind, qty: t.qty, saldo: t.saldo }))) : {}),
    [kartu]
  )

  const ringkas = useMemo(() => {
    if (!kartu || !calc) return null
    const b = kartu.barang
    let edited = 0, added = 0, removed = 0, iChanged = 0, errors = 0
    rows.forEach((r) => {
      if (r.isNew) added++
      else if (r.deleted) removed++
      else if (isEdited(r)) edited++
      if (!r.deleted && !r.isNew && r.saldo0 !== null && beda(calc.saldo[r.uid], r.saldo0)) iChanged++
      if (!r.deleted && (!TGL_RE.test(r.tanggal) || r.tanggal > kartu.today || !(r.qty > 0))) errors++
    })
    const snapChanged = kartu.snapshot.filter((s) => beda(calc.openAt(s.ym), s.saldo))
    const pembukaChanged = beda(pembuka, pembuka0)
    const total = edited + added + removed + (pembukaChanged ? 1 : 0)
    const fChanged = beda(calc.F, b.saldo_awal)
    const gChanged = beda(calc.G, b.sisa_saldo)
    // Tanpa input yang diubah pun, menyimpan tetap memperbaiki saldo yang salah.
    const fixOnly = total === 0 && (iChanged > 0 || snapChanged.length > 0 || fChanged || gChanged)
    return { edited, added, removed, iChanged, errors, snapChanged, pembukaChanged, total, fChanged, gChanged, fixOnly }
  }, [kartu, calc, rows, pembuka, pembuka0])

  if (loading && !kartu) {
    return <div className="p-10 text-center text-gray-400 text-sm">Memuat kartu stok…</div>
  }
  if (error && !kartu) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-red-600 text-sm">{error}</p>
        <button onClick={() => void load()} className="text-sm text-blue-600 hover:underline">Coba lagi</button>
      </div>
    )
  }
  if (!kartu || !calc || !ringkas) return null

  const b = kartu.barang
  const today = kartu.today
  const nowYm = kartu.nowYm

  // ── Aksi draf ──

  function updateRow(uid: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))
  }

  function toggleDelete(r: DraftRow) {
    if (r.isNew) setRows((prev) => prev.filter((x) => x.uid !== r.uid))
    else updateRow(r.uid, { deleted: !r.deleted })
  }

  /** Tambah/ubah satu baris penyesuaian per tag. Efek totalnya bertambah `delta`. */
  function setAdjust(tag: string, tanggal: string, delta: number, label: string) {
    const r = rows.find((x) => x.adj === tag)
    const ne = (r ? effOf(r) : 0) + delta
    if (r) {
      if (!beda(ne, 0)) setRows(rows.filter((x) => x !== r))
      else setRows(rows.map((x) => (x === r ? { ...x, kind: ne > 0 ? 'masuk' : 'keluar', qty: Math.abs(ne) } : x)))
      return
    }
    if (!beda(ne, 0)) return
    const seq = ++seqRef.current
    setRows([...rows, {
      uid: `n${seq}`, id: null, newSeq: seq, kind: ne > 0 ? 'masuk' : 'keluar', tanggal, qty: Math.abs(ne),
      isNew: true, kembar: false, saldo0: null, orig: null, keterangan: `[PENYESUAIAN] ${label}`, adj: tag,
    }])
  }

  function commitOpenAt(ym: number, text: string) {
    const v = Number(text)
    if (text.trim() === '' || !Number.isFinite(v) || !calc) return
    const delta = v - calc.openAt(ym)
    if (!beda(delta, 0)) return
    // Belum ada transaksi sebelum bulan ini: yang berubah adalah saldo pembuka.
    if (!calc.live.some((r) => ymOf(r.tanggal) < ym)) setPembuka((p) => p + delta)
    else setAdjust(`snap-${ym}`, lastDayBefore(ym), delta, `Saldo awal ${ymLabel(ym)} disesuaikan`)
  }

  function commitG(text: string) {
    const v = Number(text)
    if (text.trim() === '' || !Number.isFinite(v) || !calc) return
    const delta = v - calc.G
    if (beda(delta, 0)) setAdjust('g', today, delta, `Stock opname ${fmtTanggal(today)}`)
  }

  /** Loncatan yang memang hasil opname: catat sebagai transaksi tepat sebelum baris itu. */
  function jadikanPenyesuaian(uid: string, size: number) {
    if (!calc) return
    const i = calc.live.findIndex((r) => r.uid === uid)
    if (i < 0) return
    const ke = calc.live[i]
    const dari = calc.live[i - 1]
    const kind: Kind = size > 0 ? 'masuk' : 'keluar'
    let tgl = ke.tanggal
    for (const t of [ke.tanggal, dari?.tanggal].filter(Boolean) as string[]) {
      const probe: LedgerRow = { uid: 'probe', id: null, newSeq: seqRef.current + 1, kind, tanggal: t, qty: 1 }
      if (cmpRow(probe, ke) < 0 && (!dari || cmpRow(probe, dari) > 0)) { tgl = t; break }
    }
    setAdjust(`jump-${uid}`, tgl, size, `Saldo berubah ${fmtSelisih(size)} tanpa transaksi`)
  }

  function tambahTransaksi() {
    const qty = Number(newRow.qty)
    if (!TGL_RE.test(newRow.tanggal) || newRow.tanggal > today || !(qty > 0)) return
    const seq = ++seqRef.current
    setRows([...rows, {
      uid: `n${seq}`, id: null, newSeq: seq, kind: newRow.kind, tanggal: newRow.tanggal, qty,
      isNew: true, kembar: false, saldo0: null, orig: null, keterangan: '',
    }])
    setNewRow({ ...newRow, qty: '1' })
  }

  // ── Simpan ──

  function buildPayload(): SimpanKartuPayload {
    return {
      type,
      id_barang: b.id,
      baseHash: kartu!.hash,
      pembuka,
      alasan: alasan.trim(),
      ops: {
        update: rows.filter(isEdited).map((r) => ({ kind: r.kind, id: r.id!, tanggal: r.tanggal, qty: r.qty })),
        delete: rows.filter((r) => !r.isNew && r.deleted).map((r) => ({ kind: r.kind, id: r.id! })),
        // Urut newSeq: server memberi ID baru menurut urutan ini, sama dengan pratinjau.
        add: rows
          .filter((r) => r.isNew)
          .sort((x, y) => (x.newSeq ?? 0) - (y.newSeq ?? 0))
          .map((r) => ({ kind: r.kind, tanggal: r.tanggal, qty: r.qty, keterangan: r.keterangan })),
      },
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const hasil = await simpanKartu(buildPayload())
      setReview(false)
      setAlasan('')
      setNotice(`Tersimpan: ${hasil.iBerubah} saldo transaksi dan ${hasil.snapshotBerubah} snapshot ditulis ulang. Sisa saldo ${fmtAngka(hasil.G)}.`)
      await load()
      onSaved()
    } catch (err) {
      setSaveError({
        message: err instanceof Error ? err.message : 'Gagal menyimpan.',
        stale: err instanceof GudangError && err.status === 409,
      })
    } finally {
      setSaving(false)
    }
  }

  // ── Data tampilan ──

  const sorted = [...rows].sort(cmpRow)
  const validYms = sorted.filter((r) => TGL_RE.test(r.tanggal)).map((r) => ymOf(r.tanggal))
    .concat(kartu.snapshot.map((s) => s.ym))
    .filter((ym) => ym > 190000 && ym <= nowYm)
  const months: number[] = []
  for (let ym = validYms.length ? Math.min(...validYms) : nowYm; ym <= nowYm; ym = nextYm(ym)) months.push(ym)
  const monthSet = new Set(months)
  const tanpaBulan = sorted.filter((r) => !monthSet.has(ymOf(r.tanggal)))

  const masuk = calc.live.filter((r) => r.kind === 'masuk').reduce((a, r) => a + r.qty, 0)
  const keluar = calc.live.filter((r) => r.kind === 'keluar').reduce((a, r) => a + r.qty, 0)
  const masuk0 = kartu.tx.filter((t) => t.kind === 'masuk').reduce((a, t) => a + t.qty, 0)
  const keluar0 = kartu.tx.filter((t) => t.kind === 'keluar').reduce((a, t) => a + t.qty, 0)

  const sumAll = kartu.tx.reduce((a, t) => a + effOf(t), 0)
  const saran: { label: string; v: number }[] = []
  if (kartu.tx.length) saran.push({ label: 'Dari transaksi pertama', v: kartu.tx[0].saldo - effOf(kartu.tx[0]) })
  saran.push({ label: 'Dari G', v: b.sisa_saldo - sumAll })
  if (kartu.snapshot.length) {
    const s0 = kartu.snapshot[0]
    saran.push({ label: `Dari snapshot ${ymShort(s0.ym)}`, v: s0.saldo - kartu.tx.filter((t) => ymOf(t.tanggal) < s0.ym).reduce((a, t) => a + effOf(t), 0) })
  }
  const saranUnik = saran.reduce<{ label: string; v: number }[]>((acc, s) => {
    const sama = acc.find((x) => !beda(x.v, s.v))
    if (sama) sama.label += ' / ' + s.label.replace('Dari ', '')
    else acc.push({ ...s })
    return acc
  }, [])

  const adaLoncatan = Object.values(patahan).some((p) => p.jenis === 'loncatan')
  const canSave = (ringkas.total > 0 || ringkas.fixOnly) && ringkas.errors === 0

  // Fungsi render biasa, bukan komponen: komponen yang didefinisikan di dalam
  // render akan di-mount ulang tiap ketikan dan membuat kotak input kehilangan fokus.
  function renderTxRow(r: DraftRow) {
    const p = patahan[r.uid]
    const saldoBaru = r.deleted ? null : calc!.saldo[r.uid]
    const sudahDisesuaikan = rows.some((x) => x.adj === `jump-${r.uid}`)
    const tglInvalid = !r.deleted && (!TGL_RE.test(r.tanggal) || r.tanggal > today)
    const qtyInvalid = !r.deleted && !(r.qty > 0)
    const rowCls = r.deleted ? 'opacity-50 line-through' : r.isNew ? 'bg-emerald-50/60' : isEdited(r) ? 'bg-amber-50' : ''
    return (
      <tr key={r.uid} className={`border-b border-gray-100 ${rowCls}`}>
        <td className="px-3 py-1.5">
          <CommitInput
            type="date" label="Tanggal" value={r.tanggal} max={today} className="w-36"
            disabled={r.deleted || r.kembar} invalid={tglInvalid}
            onCommit={(t) => { if (TGL_RE.test(t)) updateRow(r.uid, { tanggal: t }) }}
          />
        </td>
        <td className="px-3 py-1.5"><KindTag kind={r.kind} /></td>
        <td className="px-3 py-1.5 font-mono text-xs text-gray-600 whitespace-nowrap">{r.id ?? <span className="text-gray-400">baru</span>}</td>
        <td className="px-3 py-1.5 text-right">
          <CommitInput
            label="Qty" value={r.qty} className="w-20"
            disabled={r.deleted || r.kembar} invalid={qtyInvalid}
            onCommit={(t) => updateRow(r.uid, { qty: Number(t) })}
          />
        </td>
        <td className={`px-3 py-1.5 text-right tabular-nums text-gray-500 ${r.saldo0 !== null && r.saldo0 < 0 ? 'text-red-600' : ''}`}>
          {r.saldo0 === null ? '—' : fmtAngka(r.saldo0)}
        </td>
        <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
          saldoBaru !== null && saldoBaru < 0 ? 'text-red-600'
            : saldoBaru !== null && r.saldo0 !== null && beda(saldoBaru, r.saldo0) ? 'text-amber-700' : 'text-gray-900'
        }`}>
          {saldoBaru === null ? '—' : fmtAngka(saldoBaru)}
        </td>
        <td className="px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {p?.jenis === 'loncatan' && <Tag tone="red">loncat {fmtSelisih(p.size)}</Tag>}
            {p?.jenis === 'loncatan' && !r.deleted && (sudahDisesuaikan
              ? <Tag tone="green">penyesuaian ditambahkan</Tag>
              : <button onClick={() => jadikanPenyesuaian(r.uid, p.size)} className="text-xs font-medium text-blue-600 hover:underline">Jadikan penyesuaian</button>)}
            {p?.jenis === 'terisolasi' && <Tag tone="amber">meleset {fmtSelisih(p.size)}</Tag>}
            {r.saldo0 !== null && r.saldo0 < 0 && <Tag tone="red">minus</Tag>}
            {r.kembar && <Tag tone="red">ID kembar</Tag>}
            {r.isNew && (r.adj ? <Tag tone="blue">penyesuaian</Tag> : <Tag tone="green">baru</Tag>)}
          </div>
        </td>
        <td className="px-3 py-1.5 text-right">
          {!r.kembar && (
            <button onClick={() => toggleDelete(r)} className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 no-underline">
              {r.deleted ? 'Batal' : 'Hapus'}
            </button>
          )}
        </td>
      </tr>
    )
  }

  function renderMonthRow(ym: number) {
    const isNow = ym === nowYm
    const snap = kartu!.snapshot.find((s) => s.ym === ym)
    const stored = isNow ? b.saldo_awal : snap ? snap.saldo : null
    const v = calc!.openAt(ym)
    return (
      <tr className="bg-slate-50 border-y border-gray-200">
        <td colSpan={4} className="px-3 py-2">
          <span className="font-semibold text-gray-800">{ymLabel(ym)}</span>
          <span className="text-xs text-gray-500 ml-2">{isNow ? 'saldo awal bulan (F)' : 'saldo awal bulan (snapshot)'}</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{stored === null ? <Tag tone="gray">belum ada</Tag> : fmtAngka(stored)}</td>
        <td className="px-3 py-2 text-right">
          <CommitInput label={`Saldo awal ${ymLabel(ym)}`} value={v} className="w-24 font-semibold" onCommit={(t) => commitOpenAt(ym, t)} />
        </td>
        <td className="px-3 py-2" colSpan={2}>
          {stored !== null && beda(stored, v) && <Tag tone="amber">berubah {fmtSelisih(v - stored)}</Tag>}
        </td>
      </tr>
    )
  }

  // Bulan laporan paling awal yang ikut berubah.
  const touched: number[] = []
  rows.forEach((r) => {
    if (r.isNew || r.deleted || isEdited(r)) {
      touched.push(ymOf(r.tanggal))
      if (r.orig) touched.push(ymOf(r.orig.tanggal))
    }
    if (!r.deleted && r.saldo0 !== null && beda(calc.saldo[r.uid], r.saldo0)) touched.push(ymOf(r.tanggal))
  })
  ringkas.snapChanged.forEach((s) => touched.push(s.ym))
  if (ringkas.fChanged || ringkas.gChanged) touched.push(nowYm)
  const dariYm = touched.filter((ym) => ym > 190000).length ? Math.min(...touched.filter((ym) => ym > 190000)) : nowYm

  return (
    <div className="flex flex-col">
      {/* Kepala */}
      <div className="p-5 border-b border-gray-100 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{b.nama_barang}</h2>
            <p className="text-sm text-gray-500">
              <span className="font-mono">{b.id}</span> · {b.kode_barang} · {b.merk} · satuan {b.satuan} · {TYPE_LABEL[type]}
            </p>
          </div>
          <button
            onClick={() => { setNotice(''); void load() }}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Muat ulang
          </button>
        </div>

        {notice && <div className="text-sm bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2">{notice}</div>}
        {error && <div className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
          {[
            ['Saldo pembuka', pembuka, pembuka0],
            ['Total masuk', masuk, masuk0],
            ['Total keluar', keluar, keluar0],
            ['Sisa saldo (G)', calc.G, b.sisa_saldo],
          ].map(([label, v, was]) => (
            <div key={label as string} className="bg-white px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
              <div className="text-xl font-semibold tabular-nums text-gray-900">{fmtAngka(v as number)}</div>
              <div className={`text-xs tabular-nums ${beda(v as number, was as number) ? 'text-amber-700' : 'text-gray-400'}`}>
                {beda(v as number, was as number) ? `tersimpan ${fmtAngka(was as number)}` : 'tidak berubah'}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-50 rounded-xl px-3 py-2.5 space-y-2 text-sm">
          <div>
            <span className="font-semibold text-gray-800">Pilih saldo pembuka</span>
            <span className="text-gray-500"> · atau ketik di baris pertama tabel</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {saranUnik.map((s) => (
              <button
                key={s.label}
                onClick={() => setPembuka(s.v)}
                className={`text-xs rounded-full border px-3 py-1 ${
                  !beda(pembuka, s.v) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s.label} <b className="tabular-nums">{fmtAngka(s.v)}</b>
              </button>
            ))}
          </div>
          {adaLoncatan && (
            <p className="text-gray-600">Ada loncatan. Kalau itu hasil opname, klik <b>Jadikan penyesuaian</b> di baris yang ditandai.</p>
          )}
        </div>
      </div>

      {/* Tabel */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 text-left font-semibold">Tanggal</th>
              <th className="px-3 py-2 text-left font-semibold">Jenis</th>
              <th className="px-3 py-2 text-left font-semibold">No. transaksi</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo tersimpan</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo baru</th>
              <th className="px-3 py-2 text-left font-semibold">Cek</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-blue-50/60 border-b border-gray-200">
              <td colSpan={4} className="px-3 py-2">
                <span className="font-semibold text-gray-800">Saldo pembuka</span>
                <span className="text-xs text-gray-500 ml-2">sebelum transaksi pertama</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtAngka(pembuka0)}</td>
              <td className="px-3 py-2 text-right">
                <CommitInput
                  label="Saldo pembuka" value={pembuka} className="w-24 font-semibold"
                  onCommit={(t) => { const v = Number(t); if (t.trim() !== '' && Number.isFinite(v)) setPembuka(v) }}
                />
              </td>
              <td colSpan={2}></td>
            </tr>

            {tanpaBulan.length > 0 && (
              <>
                <tr className="bg-red-50 border-y border-red-100">
                  <td colSpan={8} className="px-3 py-2 text-sm font-semibold text-red-700">Tanggal tidak valid — perbaiki tanggalnya</td>
                </tr>
                {tanpaBulan.map(renderTxRow)}
              </>
            )}

            {months.map((ym) => (
              <Fragment key={ym}>
                {renderMonthRow(ym)}
                {sorted.filter((r) => ymOf(r.tanggal) === ym).map(renderTxRow)}
              </Fragment>
            ))}

            <tr className="border-t border-dashed border-gray-300">
              <td className="px-3 py-2">
                <input
                  type="date" aria-label="Tanggal transaksi baru" value={newRow.tanggal} max={today}
                  onChange={(e) => setNewRow({ ...newRow, tanggal: e.target.value })}
                  className="w-36 border border-gray-300 rounded-md px-2 py-1 text-sm"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  aria-label="Jenis transaksi baru" value={newRow.kind}
                  onChange={(e) => setNewRow({ ...newRow, kind: e.target.value as Kind })}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
                >
                  <option value="masuk">Masuk</option>
                  <option value="keluar">Keluar</option>
                </select>
              </td>
              <td className="px-3 py-2 text-xs text-gray-400">ID dibuat saat simpan</td>
              <td className="px-3 py-2 text-right">
                <input
                  type="number" min={1} aria-label="Qty transaksi baru" value={newRow.qty}
                  onChange={(e) => setNewRow({ ...newRow, qty: e.target.value })}
                  className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                />
              </td>
              <td colSpan={4} className="px-3 py-2">
                <button
                  onClick={tambahTransaksi}
                  disabled={!TGL_RE.test(newRow.tanggal) || newRow.tanggal > today || !(Number(newRow.qty) > 0)}
                  className="flex items-center gap-1 text-sm border border-gray-300 rounded-lg px-3 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Plus size={14} /> Tambah transaksi
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-gray-300">
              <td colSpan={4} className="px-3 py-2.5 font-medium text-gray-800">
                Sisa saldo (G) <span className="text-xs text-gray-500 font-normal">· isi stok fisik jika berbeda</span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{fmtAngka(b.sisa_saldo)}</td>
              <td className="px-3 py-2.5 text-right">
                <CommitInput label="Sisa saldo G" value={calc.G} className="w-24 font-semibold" onCommit={commitG} />
              </td>
              <td colSpan={2} className="px-3 py-2.5">
                {ringkas.gChanged && <Tag tone="amber">berubah {fmtSelisih(calc.G - b.sisa_saldo)}</Tag>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 px-5 py-2.5 text-xs text-gray-500 border-t border-gray-100">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-amber-100 inline-block" />diedit</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-100 inline-block" />transaksi baru</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" />saldo berubah</span>
        <span>Saldo tersimpan = angka di sheet sekarang</span>
      </div>

      {/* Bar aksi */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3 rounded-b-xl shadow-[0_-6px_16px_rgba(15,23,42,0.06)]">
        <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
          {ringkas.total === 0 ? <span>Belum ada perubahan.</span> : <b className="text-gray-900">{ringkas.total} perubahan</b>}
          {ringkas.iChanged > 0 && <span>· {ringkas.iChanged} saldo berubah</span>}
          {ringkas.snapChanged.length > 0 && <span>· {ringkas.snapChanged.length} snapshot</span>}
          {ringkas.gChanged && <span>· G {fmtAngka(b.sisa_saldo)} → {fmtAngka(calc.G)}</span>}
          {ringkas.fixOnly && <Tag tone="amber">saldo yang salah akan diperbaiki</Tag>}
          {calc.min < 0 && <Tag tone="red">masih ada saldo minus</Tag>}
          {ringkas.errors > 0 && <Tag tone="red">{ringkas.errors} baris belum valid</Tag>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setNotice(''); void load() }}
            disabled={ringkas.total === 0}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Batalkan perubahan
          </button>
          <button
            onClick={() => { setSaveError(null); setReview(true) }}
            disabled={!canSave}
            className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Tinjau &amp; simpan
          </button>
        </div>
      </div>

      {review && (
        <Modal
          title={`Tinjau perubahan · ${b.nama_barang}`}
          size="lg"
          onClose={() => { if (!saving) setReview(false) }}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setReview(false)} disabled={saving} className="text-sm border border-gray-300 rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-50">
                Kembali
              </button>
              {saveError?.stale ? (
                <button
                  onClick={() => { setReview(false); setNotice(''); void load() }}
                  className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700"
                >
                  Muat ulang kartu
                </button>
              ) : (
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || alasan.trim().length < 5}
                  className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              )}
            </div>
          }
        >
          {renderReview()}
        </Modal>
      )}
    </div>
  )

  function renderReview() {
    const lines: [string, React.ReactNode][] = []
    if (ringkas!.pembukaChanged) lines.push(['Pembuka', `${fmtAngka(pembuka0)} → ${fmtAngka(pembuka)}`])
    rows.forEach((r) => {
      if (r.isNew) {
        lines.push(['Tambah', `${r.kind === 'masuk' ? 'Masuk' : 'Keluar'} ${fmtAngka(r.qty)} ${b.satuan} pada ${fmtTanggal(r.tanggal)}${r.adj ? ' (penyesuaian)' : ''}`])
      } else if (r.deleted) {
        lines.push(['Hapus', <span key={r.uid}><span className="font-mono">{r.id}</span> · {r.kind} {fmtAngka(r.orig!.qty)} · {fmtTanggal(r.orig!.tanggal)}</span>])
      } else if (isEdited(r)) {
        const p: string[] = []
        if (r.tanggal !== r.orig!.tanggal) p.push(`tanggal ${fmtTanggal(r.orig!.tanggal)} → ${fmtTanggal(r.tanggal)}`)
        if (r.qty !== r.orig!.qty) p.push(`qty ${fmtAngka(r.orig!.qty)} → ${fmtAngka(r.qty)}`)
        lines.push(['Ubah', <span key={r.uid}><span className="font-mono">{r.id}</span> · {p.join(', ')}</span>])
      }
    })
    const der: [string, string][] = []
    if (ringkas!.iChanged) der.push(['Kolom I', `${ringkas!.iChanged} baris transaksi`])
    ringkas!.snapChanged.forEach((s) => der.push(['Snapshot', `${ymLabel(s.ym)}: ${fmtAngka(s.saldo)} → ${fmtAngka(calc!.openAt(s.ym))}`]))
    if (ringkas!.fChanged) der.push(['Master F', `${fmtAngka(b.saldo_awal)} → ${fmtAngka(calc!.F)}`])
    if (ringkas!.gChanged) der.push(['Master G', `${fmtAngka(b.sisa_saldo)} → ${fmtAngka(calc!.G)}`])

    const list = (items: [string, React.ReactNode][]) => (
      <ul className="space-y-1 text-sm">
        {items.map(([k, v], i) => (
          <li key={i} className="flex gap-3"><span className="w-20 shrink-0 text-xs text-gray-500 pt-0.5">{k}</span><span>{v}</span></li>
        ))}
      </ul>
    )

    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Angka di bawah adalah pratinjau. Server menghitung ulang saat menyimpan.</p>
        {lines.length > 0
          ? <div><div className="font-semibold text-sm mb-1">Yang Anda ubah</div>{list(lines)}</div>
          : <p className="text-sm text-gray-600">Tidak ada input yang diubah. Hanya saldo yang salah yang diperbaiki.</p>}
        {der.length > 0 && <div><div className="font-semibold text-sm mb-1">Yang ikut berubah</div>{list(der)}</div>}
        {dariYm < nowYm && (
          <div className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
            Laporan stok <b>{ymLabel(dariYm)}</b> sampai <b>{ymLabel(nowYm)}</b> ikut berubah.
          </div>
        )}
        {calc!.min < 0 && (
          <div className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">
            Saldo masih minus (terendah {fmtAngka(calc!.min)}). Cek tanggal transaksi masuk.
          </div>
        )}
        <div>
          <label htmlFor="alasan" className="block text-sm font-semibold mb-1">
            Alasan perubahan <span className="font-normal text-gray-500">(wajib)</span>
          </label>
          <textarea
            id="alasan"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Contoh: hasil opname 30 September."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {saveError && <div className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{saveError.message}</div>}
      </div>
    )
  }
}
