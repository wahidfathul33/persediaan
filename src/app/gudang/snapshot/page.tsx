'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { KeluarType } from '@/lib/api'
import { getSnapshotStatus, isiSnapshot, rolloverManual, type SnapshotStatus } from '@/lib/gudang'
import { prevYm, ymLabel } from '@/lib/ledger'
import Modal from '@/components/Modal'
import Toast from '@/components/Toast'

const TYPES: KeluarType[] = ['atk', 'rt', 'obat']
const LABEL: Record<KeluarType, string> = { atk: 'ATK', rt: 'RT', obat: 'Obat' }

function Cell({ n, total }: { n: number; total: number }) {
  if (n === 0) return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">kosong</span>
  if (n < total) return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 tabular-nums">{n} / {total}</span>
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 tabular-nums">{n} / {total}</span>
}

export default function SnapshotPage() {
  const [status, setStatus] = useState<SnapshotStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyYm, setBusyYm] = useState<number | null>(null)
  const [confirmRollover, setConfirmRollover] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setStatus(await getSnapshotStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat status snapshot.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleIsi(ym: number) {
    setBusyYm(ym)
    try {
      const r = await isiSnapshot(ym)
      setToast({ msg: `Snapshot ${ymLabel(ym)}: ${r.ditambah} baris ditambahkan.`, type: 'success' })
      await load()
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : 'Gagal mengisi snapshot.', type: 'error' })
    } finally {
      setBusyYm(null)
    }
  }

  async function handleRollover() {
    setRolling(true)
    try {
      const r = await rolloverManual()
      setConfirmRollover(false)
      setToast({ msg: `Rollover selesai. Snapshot ${ymLabel(r.snapYear * 100 + r.snapMonth)} dibuat.`, type: 'success' })
      await load()
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : 'Rollover gagal.', type: 'error' })
    } finally {
      setRolling(false)
    }
  }

  const kurang = (m: SnapshotStatus['months'][number]) => status !== null && TYPES.some((t) => m[t] < status.totals[t])
  const belumLengkap = status ? status.months.filter(kurang) : []
  const palingLama = belumLengkap.length ? belumLengkap[belumLengkap.length - 1].ym : null
  const bulanLalu = status ? prevYm(status.nowYm) : null
  const snapBulanLalu = status?.months.find((m) => m.ym === bulanLalu)
  const rolloverSudah = !!snapBulanLalu && TYPES.some((t) => snapBulanLalu[t] > 0)

  return (
    <div className="space-y-5">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} duration={5000} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Snapshot &amp; rollover</h1>
          <p className="text-sm text-gray-500 mt-1">Saldo awal tiap barang per bulan. Laporan bulan lalu memakai data ini.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Muat ulang
        </button>
      </div>

      {error && <div className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 space-y-2">
            <h2 className="font-semibold text-gray-900">Status per bulan</h2>
            {belumLengkap.length > 0 ? (
              <p className="text-sm bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
                {belumLengkap.length} bulan belum lengkap. Isi mulai dari bulan paling lama. Angka “sebagian” bisa normal untuk barang yang ditambahkan setelah bulan itu.
              </p>
            ) : status && (
              <p className="text-sm text-gray-500">Semua bulan lengkap.</p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 text-left font-semibold">Bulan</th>
                  {TYPES.map((t) => <th key={t} className="px-4 py-2 text-left font-semibold">{LABEL[t]}</th>)}
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && !status && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Memuat…</td></tr>}
                {status?.months.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">Belum ada snapshot sama sekali.</td></tr>}
                {status?.months.map((m) => (
                  <tr key={m.ym} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">{ymLabel(m.ym)}</td>
                    {TYPES.map((t) => <td key={t} className="px-4 py-2.5"><Cell n={m[t]} total={status.totals[t]} /></td>)}
                    <td className="px-4 py-2.5 text-right">
                      {kurang(m) && (
                        <button
                          onClick={() => void handleIsi(m.ym)}
                          disabled={busyYm !== null}
                          className={`text-xs rounded-lg px-3 py-1.5 border disabled:opacity-50 ${
                            m.ym === palingLama ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {busyYm === m.ym ? 'Mengisi…' : 'Isi yang kosong'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2">
            <h2 className="font-semibold text-gray-900">Cara pengisian</h2>
            <p className="text-sm text-gray-600">Dihitung dari snapshot terdekat sebelumnya + transaksi sampai akhir bulan sebelumnya.</p>
            <p className="text-sm text-gray-600">Data yang sudah ada tidak ditimpa.</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
            <h2 className="font-semibold text-gray-900">Rollover bulanan</h2>
            <p className="text-sm text-gray-600">Berjalan otomatis tiap tanggal 1 pukul 02:00 WIB.</p>
            {status && bulanLalu && (
              rolloverSudah ? (
                <p className="text-sm bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2">
                  Rollover bulan ini sudah jalan (snapshot {ymLabel(bulanLalu)} ada).
                </p>
              ) : (
                <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">
                  Snapshot {ymLabel(bulanLalu)} belum ada. Rollover bulan ini kemungkinan gagal.
                </p>
              )
            )}
            <button
              onClick={() => setConfirmRollover(true)}
              disabled={!status || rolloverSudah}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Jalankan rollover manual
            </button>
            {rolloverSudah && (
              <p className="text-xs text-gray-500">Tidak bisa dijalankan lagi: saldo awal bulan ini akan jadi salah.</p>
            )}
          </div>
        </div>
      </div>

      {confirmRollover && bulanLalu && (
        <Modal
          title="Jalankan rollover manual?"
          onClose={() => { if (!rolling) setConfirmRollover(false) }}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRollover(false)} disabled={rolling} className="text-sm border border-gray-300 rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-50">Batal</button>
              <button onClick={() => void handleRollover()} disabled={rolling} className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50">
                {rolling ? 'Menjalankan…' : 'Jalankan'}
              </button>
            </div>
          }
        >
          <div className="space-y-2 text-sm text-gray-700">
            <p>Ini akan menyimpan snapshot {ymLabel(bulanLalu)}, lalu menyalin sisa saldo (G) ke saldo awal (F) semua barang.</p>
            <p className="text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Jalankan hanya jika belum ada transaksi bulan ini. Transaksi bulan ini yang sudah ada akan ikut masuk ke saldo awal.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
