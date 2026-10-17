/**
 * Hitungan saldo satu barang untuk pratinjau Kartu Stok.
 *
 * Harus sama dengan Apps Script (makePos, buildLedgers, tulisUlangSaldoBarang):
 * urutan transaksi = tanggal, lalu masuk sebelum keluar, lalu nomor di ID.
 * Server tetap menghitung ulang sendiri saat menyimpan; ini hanya pratinjau.
 */

export type Kind = 'masuk' | 'keluar'

export interface LedgerRow {
  uid: string
  id: string | null
  /** Urutan pembuatan untuk baris baru; server memberi ID menurut urutan yang sama. */
  newSeq?: number
  kind: Kind
  tanggal: string
  qty: number
  deleted?: boolean
}

export const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

export const ymOf = (tanggal: string) => Number(tanggal.slice(0, 4)) * 100 + Number(tanggal.slice(5, 7))
export const ymLabel = (ym: number) => `${BULAN[(ym % 100) - 1] ?? '?'} ${Math.floor(ym / 100)}`
export const ymShort = (ym: number) => `${BLN[(ym % 100) - 1] ?? '?'} ${Math.floor(ym / 100)}`

export function fmtTanggal(t: string): string {
  const [y, m, d] = t.split('-')
  return `${Number(d)} ${BLN[Number(m) - 1] ?? '?'} ${y}`
}

export function nextYm(ym: number): number {
  return ym % 100 === 12 ? (Math.floor(ym / 100) + 1) * 100 + 1 : ym + 1
}

export function prevYm(ym: number): number {
  return ym % 100 === 1 ? (Math.floor(ym / 100) - 1) * 100 + 12 : ym - 1
}

/** Tanggal terakhir bulan sebelum `ym`, format YYYY-MM-DD. */
export function lastDayBefore(ym: number): string {
  const p = prevYm(ym)
  const y = Math.floor(p / 100)
  const m = p % 100
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const dayKey = (t: string) => Number(t.replace(/-/g, '')) || 0

export function seqOf(id: string | null): number {
  const m = /-(\d+)$/.exec(String(id ?? '').trim())
  return m ? Number(m[1]) : 0
}

export function effOf(r: { kind: Kind; qty: number }): number {
  return r.kind === 'masuk' ? r.qty : -r.qty
}

function posOf(r: LedgerRow): [number, number, number] {
  return [dayKey(r.tanggal), r.kind === 'masuk' ? 0 : 1, r.id ? seqOf(r.id) : 1e9 + (r.newSeq ?? 0)]
}

export function cmpRow(a: LedgerRow, b: LedgerRow): number {
  const p = posOf(a)
  const q = posOf(b)
  for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i] - q[i]
  return 0
}

export interface LedgerResult {
  /** Baris yang tidak dihapus, sudah urut. */
  live: LedgerRow[]
  /** Saldo setelah tiap transaksi, per uid. */
  saldo: Record<string, number>
  G: number
  F: number
  /** Saldo terendah sepanjang riwayat. */
  min: number
  /** Saldo di awal bulan `ym`. */
  openAt: (ym: number) => number
}

export function computeLedger(rows: LedgerRow[], pembuka: number, nowYm: number): LedgerResult {
  const live = rows.filter((r) => !r.deleted).sort(cmpRow)
  const saldo: Record<string, number> = {}
  let s = pembuka
  let min = pembuka
  live.forEach((r) => {
    s += effOf(r)
    saldo[r.uid] = s
    min = Math.min(min, s)
  })
  const openAt = (ym: number) => live.reduce((v, r) => (ymOf(r.tanggal) < ym ? v + effOf(r) : v), pembuka)
  return { live, saldo, G: s, F: openAt(nowYm), min, openAt }
}

export interface Patahan {
  jenis: 'loncatan' | 'terisolasi'
  size: number
}

/**
 * Patahan rantai saldo yang TERSIMPAN (logika cekKontinuitas): untuk transaksi
 * berurutan, saldo[k] − saldo[k−1] harus sama dengan efek transaksi k.
 * Patahan +x yang langsung dibatalkan −x di baris berikutnya = satu baris salah
 * tulis (terisolasi); selain itu loncatan.
 *
 * @param led baris tersimpan, sudah urut
 * @returns uid baris → patahan di baris itu
 */
export function patahanTersimpan(led: { uid: string; kind: Kind; qty: number; saldo: number }[]): Record<string, Patahan> {
  const jumps: { i: number; size: number }[] = []
  for (let i = 1; i < led.length; i++) {
    const j = (led[i].saldo - led[i - 1].saldo) - effOf(led[i])
    if (Math.abs(j) > 1e-9) jumps.push({ i, size: j })
  }
  const out: Record<string, Patahan> = {}
  let k = 0
  while (k < jumps.length) {
    const a = jumps[k]
    const nx = jumps[k + 1]
    if (nx && nx.i === a.i + 1 && Math.abs(a.size + nx.size) < 1e-9) {
      out[led[a.i].uid] = { jenis: 'terisolasi', size: a.size }
      k += 2
    } else {
      out[led[a.i].uid] = { jenis: 'loncatan', size: a.size }
      k++
    }
  }
  return out
}

export const fmtAngka = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('id-ID')
export const fmtSelisih = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtAngka(Math.abs(n))
