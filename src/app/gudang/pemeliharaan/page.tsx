'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { KeluarType } from '@/lib/api'
import {
  bersihkanCache, getAnomali, perbaikiIdKembar, rebuildSaldo,
  type IdKembarReport, type RebuildReport,
} from '@/lib/gudang'
import { ymLabel } from '@/lib/ledger'
import Toast from '@/components/Toast'

const TYPES: KeluarType[] = ['atk', 'rt', 'obat']
const LABEL: Record<KeluarType, string> = { atk: 'ATK', rt: 'RT', obat: 'Obat' }

const card = 'bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3'
const btn = 'text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export default function PemeliharaanPage() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Hitung ulang semua saldo
  const [rebuild, setRebuild] = useState<RebuildReport | null>(null)
  const [loncatan, setLoncatan] = useState(0)
  const [rebuildBusy, setRebuildBusy] = useState<'cek' | 'terapkan' | null>(null)
  const [setuju, setSetuju] = useState(false)

  // ID kembar
  const [dup, setDup] = useState<IdKembarReport | null>(null)
  const [dupFixed, setDupFixed] = useState(false)
  const [dupBusy, setDupBusy] = useState(false)

  const [cacheBusy, setCacheBusy] = useState(false)

  const gagal = (err: unknown, fallback: string) =>
    setToast({ msg: err instanceof Error ? err.message : fallback, type: 'error' })

  async function cekRebuild() {
    setRebuildBusy('cek')
    setSetuju(false)
    try {
      const [r, a] = await Promise.all([rebuildSaldo(false), getAnomali()])
      setRebuild(r)
      setLoncatan(a.items.filter((x) => x.loncatan > 0).length)
    } catch (err) {
      gagal(err, 'Pemeriksaan gagal.')
    } finally {
      setRebuildBusy(null)
    }
  }

  async function terapkanRebuild() {
    setRebuildBusy('terapkan')
    try {
      const r = await rebuildSaldo(true)
      const total = TYPES.reduce((n, t) => n + (r.types[t]?.iMasuk ?? 0) + (r.types[t]?.iKeluar ?? 0) + (r.types[t]?.f ?? 0), 0) + r.snapshot
      setRebuild(null)
      setSetuju(false)
      setToast({ msg: `Selesai: ${total} nilai diperbaiki.`, type: 'success' })
    } catch (err) {
      gagal(err, 'Perbaikan gagal.')
    } finally {
      setRebuildBusy(null)
    }
  }

  async function cekDup(apply: boolean) {
    setDupBusy(true)
    try {
      setDup(await perbaikiIdKembar(apply))
      setDupFixed(apply)
      if (apply) setToast({ msg: 'ID kembar diperbaiki.', type: 'success' })
    } catch (err) {
      gagal(err, 'Pemeriksaan ID gagal.')
    } finally {
      setDupBusy(false)
    }
  }

  async function handleCache() {
    setCacheBusy(true)
    try {
      await bersihkanCache()
      setToast({ msg: 'Cache laporan dibersihkan.', type: 'success' })
    } catch (err) {
      gagal(err, 'Gagal membersihkan cache.')
    } finally {
      setCacheBusy(false)
    }
  }

  const totalRebuild = rebuild
    ? TYPES.reduce((n, t) => n + (rebuild.types[t]?.iMasuk ?? 0) + (rebuild.types[t]?.iKeluar ?? 0) + (rebuild.types[t]?.f ?? 0), 0) + rebuild.snapshot
    : 0
  const dupCount = dup ? dup.transaksi.reduce((n, x) => n + x.baris.length, 0) : 0

  return (
    <div className="space-y-5">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} duration={5000} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pemeliharaan</h1>
        <p className="text-sm text-gray-500 mt-1">Perbaikan untuk semua barang. Semua tombol memeriksa dulu sebelum mengubah data.</p>
      </div>

      <div className={card}>
        <h2 className="font-semibold text-gray-900">Hitung ulang semua saldo</h2>
        <p className="text-sm text-gray-600">Hitung ulang kolom I, F, dan snapshot semua barang, berpatokan pada G.</p>
        <div>
          <button onClick={() => void cekRebuild()} disabled={rebuildBusy !== null} className={btn}>
            {rebuildBusy === 'cek' ? 'Memeriksa…' : 'Periksa (tidak menulis)'}
          </button>
        </div>

        {rebuild && (
          <div className="space-y-3">
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 text-left font-semibold">Jenis</th>
                    <th className="px-3 py-2 text-right font-semibold">Kolom I masuk</th>
                    <th className="px-3 py-2 text-right font-semibold">Kolom I keluar</th>
                    <th className="px-3 py-2 text-right font-semibold">Kolom F</th>
                  </tr>
                </thead>
                <tbody>
                  {TYPES.map((t) => (
                    <tr key={t} className="border-b border-gray-100 last:border-0 tabular-nums">
                      <td className="px-3 py-2">{LABEL[t]}</td>
                      <td className="px-3 py-2 text-right">{rebuild.types[t]?.iMasuk ?? 0}</td>
                      <td className="px-3 py-2 text-right">{rebuild.types[t]?.iKeluar ?? 0}</td>
                      <td className="px-3 py-2 text-right">{rebuild.types[t]?.f ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-600">
              Snapshot berbeda: <b>{rebuild.snapshot}</b>
              {Object.keys(rebuild.perBulan).length > 0 && (
                <> ({Object.entries(rebuild.perBulan).sort().map(([ym, n]) => `${ymLabel(Number(ym))}: ${n}`).join(', ')})</>
              )}
            </p>

            {totalRebuild === 0 ? (
              <p className="text-sm bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2">Semua saldo sudah sesuai. Tidak ada yang perlu diperbaiki.</p>
            ) : (
              <>
                {loncatan > 0 && (
                  <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">
                    <b>{loncatan} barang punya loncatan.</b> Riwayatnya akan ikut berubah. Sebaiknya perbaiki dulu di{' '}
                    <Link href="/gudang" className="underline">Kontinuitas</Link>.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} className="mt-0.5" />
                  Saya sudah memeriksa barang yang punya loncatan.
                </label>
                <button
                  onClick={() => void terapkanRebuild()}
                  disabled={!setuju || rebuildBusy !== null}
                  className="text-sm bg-red-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {rebuildBusy === 'terapkan' ? 'Menerapkan…' : `Terapkan perbaikan (${totalRebuild} nilai)`}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        <div className={card}>
          <h2 className="font-semibold text-gray-900">ID transaksi kembar</h2>
          <p className="text-sm text-gray-600">Transaksi dengan ID kembar tidak bisa diedit atau dihapus.</p>
          <div>
            <button onClick={() => void cekDup(false)} disabled={dupBusy} className={btn}>
              {dupBusy && !dup ? 'Memeriksa…' : 'Periksa'}
            </button>
          </div>
          {dup && (
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-sm space-y-2">
              {dup.transaksi.length === 0 && dup.barang.length === 0 && <p className="text-emerald-700">Tidak ada ID kembar.</p>}
              {dup.transaksi.map((x) => (
                <div key={x.sheet}>
                  <b>{x.sheet}</b>:{' '}
                  {x.baris.map((r) => (
                    <span key={r.row} className="font-mono text-xs mr-2">
                      baris {r.row} {r.id}{r.idBaru ? ` → ${r.idBaru}` : ''}
                    </span>
                  ))}
                </div>
              ))}
              {dup.barang.length > 0 && (
                <p className="text-red-700">
                  ID master barang kembar (perbaiki manual di sheet): {dup.barang.map((x) => `${LABEL[x.type]} ${x.id}`).join(', ')}
                </p>
              )}
              {!dupFixed && dupCount > 0 && (
                <>
                  <p className="text-gray-500">Baris pertama tetap, baris kembar diberi ID baru.</p>
                  <button
                    onClick={() => void cekDup(true)}
                    disabled={dupBusy}
                    className="text-sm bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {dupBusy ? 'Memperbaiki…' : `Perbaiki ${dupCount} ID kembar`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className={card}>
          <h2 className="font-semibold text-gray-900">Cache laporan</h2>
          <p className="text-sm text-gray-600">Pakai jika sheet diedit langsung tapi angka di aplikasi belum berubah.</p>
          <div>
            <button onClick={() => void handleCache()} disabled={cacheBusy} className={btn}>
              {cacheBusy ? 'Membersihkan…' : 'Bersihkan cache laporan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
