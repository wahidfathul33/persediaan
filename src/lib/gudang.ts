import type { KeluarType } from '@/lib/api'
import type { Kind } from '@/lib/ledger'

/**
 * Client menu Gudang. Semua panggilan lewat /api/gudang/[aksi] (server Next.js),
 * tidak pernah langsung ke Apps Script — kunci gudang hanya ada di server.
 */

export class GudangError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function call<T>(aksi: string, body: object = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/gudang/${aksi}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new GudangError('Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.', 0)
  }

  const payload = await res.json().catch(() => null)
  if (res.status === 401) {
    window.location.href = `/gudang/login?from=${encodeURIComponent(window.location.pathname)}`
    throw new GudangError('Sesi berakhir. Silakan login ulang.', 401)
  }
  if (!res.ok || !payload || payload.status === 'error') {
    throw new GudangError(payload?.message ?? `Permintaan gagal (HTTP ${res.status}).`, res.status)
  }
  return payload.data as T
}

// ─── Tipe ─────────────────────────────────────────────────────────────────────

export interface AnomaliItem {
  type: KeluarType
  id_barang: string
  kode_barang: string
  nama_barang: string
  merk: string
  satuan: string
  transaksi: number
  loncatan: number
  terisolasi: number
  ujung: number
  fDrift: number
  snapshot: number
  minus: boolean
  kembar: boolean
}

export interface AnomaliData {
  items: AnomaliItem[]
  totalBarang: number
  nowYm: number
}

export interface KartuTx {
  kind: Kind
  id: string
  tanggal: string
  qty: number
  saldo: number
  keterangan: string
  kembar: boolean
}

export interface KartuData {
  barang: {
    id: string
    kode_barang: string
    nama_barang: string
    merk: string
    satuan: string
    saldo_awal: number
    sisa_saldo: number
  }
  tx: KartuTx[]
  snapshot: { ym: number; saldo: number }[]
  hash: string
  nowYm: number
  today: string
}

export interface SimpanKartuPayload {
  type: KeluarType
  id_barang: string
  baseHash: string
  pembuka: number
  alasan: string
  ops: {
    update: { kind: Kind; id: string; tanggal: string; qty: number }[]
    delete: { kind: Kind; id: string }[]
    add: { kind: Kind; tanggal: string; qty: number; keterangan: string }[]
  }
}

/** Transaksi yang saldo kolom I-nya berubah. */
export interface BarisTerdampak {
  kind: Kind
  id: string
  tanggal: string
  qty: number
  saldoLama: number
  saldoBaru: number
}

export interface SimpanKartuHasil {
  iBerubah: number
  snapshotBerubah: number
  F: number
  G: number
  Flama: number
  Glama: number
  idBaru: string[]
  /** Tidak ada di Apps Script sebelum v3.8. */
  terdampak?: BarisTerdampak[]
}

export interface SnapshotStatus {
  months: { ym: number; atk: number; rt: number; obat: number }[]
  totals: Record<KeluarType, number>
  nowYm: number
}

export interface RebuildReport {
  types: Partial<Record<KeluarType, { iMasuk: number; iKeluar: number; f: number }>>
  snapshot: number
  perBulan: Record<string, number>
}

export interface IdKembarReport {
  barang: { type: KeluarType; id: string }[]
  transaksi: { sheet: string; baris: { row: number; id: string; idBaru?: string }[] }[]
}

export interface LogEntry {
  waktu: string
  petugas: string
  aksi: string
  type: string
  id_barang: string
  nama_barang: string
  ringkasan: string
  alasan: string
}

// ─── Aksi ─────────────────────────────────────────────────────────────────────

export const getAnomali = () => call<AnomaliData>('anomali')
export const getKartu = (type: KeluarType, id_barang: string) => call<KartuData>('kartu', { type, id_barang })
export const simpanKartu = (payload: SimpanKartuPayload) => call<SimpanKartuHasil>('simpan-kartu', payload)
export const getSnapshotStatus = () => call<SnapshotStatus>('snapshot-status')
export const isiSnapshot = (ym: number) => call<{ ym: number; ditambah: number }>('isi-snapshot', { ym, alasan: 'Isi snapshot dari menu Gudang' })
export const rebuildSaldo = (apply: boolean) => call<RebuildReport>('rebuild', { apply, alasan: 'Pemeliharaan dari menu Gudang' })
export const perbaikiIdKembar = (apply: boolean) => call<IdKembarReport>('id-kembar', { apply, alasan: 'Pemeliharaan dari menu Gudang' })
export const rolloverManual = () => call<{ snapYear: number; snapMonth: number }>('rollover', { alasan: 'Rollover manual dari menu Gudang' })
export const bersihkanCache = () => call<void>('bersihkan-cache')
export const getLogGudang = () => call<LogEntry[]>('log', { limit: 300 })

export const TYPE_LABEL: Record<KeluarType, string> = { atk: 'ATK', rt: 'RT', obat: 'Obat' }

/** Skor untuk mengurutkan daftar: yang paling perlu dicek di atas. */
export function skorAnomali(a: AnomaliItem): number {
  return a.loncatan * 3 + (a.minus ? 3 : 0) + (a.ujung ? 3 : 0) + (a.kembar ? 2 : 0) +
    a.terisolasi + (a.fDrift ? 1 : 0) + (a.snapshot ? 1 : 0)
}
