const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export type KeluarType = 'atk' | 'rt' | 'obat'

export interface Barang {
  id: string
  kode_barang: string
  nama_barang: string
  merk: string
  satuan: string
  saldo_awal: number
  sisa_saldo: number
}

export interface BarangGrouped {
  atk: Barang[]
  rt: Barang[]
  obat: Barang[]
}

export interface Keluar {
  id: string
  id_barang: string
  kode_barang: string
  nama_barang: string
  merk: string
  satuan: string
  tanggal: string
  qty: number
  sisa_saldo: number
  keterangan: string
}

export interface StokItem {
  id_barang: string
  type: KeluarType
  kode_barang: string
  nama_barang: string
  merk: string
  satuan: string
  saldo_awal: number
  sisa_saldo: number
  total_pemakaian: number
  total_masuk?: number
  total_keluar?: number
  saldo_awal_source?: string
  days_in_month: number
  keluar_per_tanggal: number[]
  masuk_per_tanggal?: number[]
}

function parseStokRow(r: unknown): StokItem {
  const row: Record<string, unknown> =
    r && typeof r === 'object' ? (r as Record<string, unknown>) : {}

  const rawType = String(row.type ?? '').toLowerCase()
  const type: KeluarType = rawType === 'atk' || rawType === 'rt' || rawType === 'obat' ? rawType : 'atk'
  const totalKeluar = Number(row.total_pemakaian ?? row.total_keluar ?? 0)
  const keluarPerTanggal = Array.isArray(row.keluar_per_tanggal) ? row.keluar_per_tanggal : []
  const masukPerTanggal = Array.isArray(row.masuk_per_tanggal) ? row.masuk_per_tanggal : undefined

  return {
    id_barang: String(row.id_barang ?? ''),
    type,
    kode_barang: String(row.kode_barang ?? ''),
    nama_barang: String(row.nama_barang ?? ''),
    merk: String(row.merk ?? ''),
    satuan: String(row.satuan ?? ''),
    saldo_awal: Number(row.saldo_awal ?? 0),
    sisa_saldo: Number(row.sisa_saldo ?? 0),
    total_pemakaian: totalKeluar,
    total_masuk: Number(row.total_masuk ?? 0),
    total_keluar: Number(row.total_keluar ?? totalKeluar),
    saldo_awal_source: String(row.saldo_awal_source ?? ''),
    days_in_month: Number(row.days_in_month ?? 30),
    keluar_per_tanggal: keluarPerTanggal.map((n: unknown) => Number(n) || 0),
    masuk_per_tanggal: masukPerTanggal
      ? masukPerTanggal.map((n: unknown) => Number(n) || 0)
      : undefined,
  }
}

function parseDate(val: unknown): string {
  if (!val) return ''
  const s = String(val)
  // Jika sudah format YYYY-MM-DD, langsung return tanpa parsing lewat Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  return s
}

// Apps Script sesekali membalas 404 dari host redirect script.googleusercontent.com
// walau deployment-nya sehat. Error ini transien, jadi GET diulang.
//
// Yang dijaga ketat di sini adalah WAKTU TUNGGU PENGGUNA, bukan jumlah percobaan.
// Latensi Apps Script sangat bervariasi (terukur 2 detik s/d 40 detik untuk request
// yang sama), jadi mengulang 4 kali tanpa batas waktu bisa membuat layar berputar
// hampir 2 menit. TOTAL_BUDGET_MS memutus rantai itu: begitu anggaran habis,
// percobaan berikutnya tidak dimulai dan error langsung ditampilkan.
const RETRY_DELAYS_MS = [400, 1200]
const TOTAL_BUDGET_MS = 45000
const PER_ATTEMPT_TIMEOUT_MS = 25000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Gabungkan signal pemanggil dengan timeout per percobaan. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function apiFetch(input: RequestInfo, init?: RequestInit) {
  // POST tidak boleh diulang otomatis — berisiko dobel tulis ke sheet.
  const canRetry = !init?.method || init.method.toUpperCase() === 'GET'
  const attempts = canRetry ? RETRY_DELAYS_MS.length + 1 : 1
  const callerSignal = init?.signal ?? undefined
  const startedAt = Date.now()

  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i - 1])

    // Timeout percobaan ini tidak boleh melampaui sisa anggaran, supaya total
    // waktu tunggu benar-benar terkunci di TOTAL_BUDGET_MS.
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt)
    if (remaining <= 0) break

    try {
      const res = await fetch(input, {
        ...init,
        signal: withTimeout(callerSignal, Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining)),
      })
      if (res.ok) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      // Abort dari pemanggil (ganti bulan / pindah halaman) bukan kegagalan —
      // jangan diulang. Timeout per percobaan boleh diulang.
      if (callerSignal?.aborted) throw err
      lastError = err
    }
  }
  throw lastError
}

interface FetchOptions {
  signal?: AbortSignal
}

interface StokFetchOptions extends FetchOptions {
  /** Paksa Apps Script menghitung ulang, melewati cache 6 jam miliknya. */
  refresh?: boolean
}

function parseBarangRow(r: unknown[]): Barang {
  return {
    id: String(r[0]),
    kode_barang: String(r[1]),
    nama_barang: String(r[2]),
    merk: String(r[3]),
    satuan: String(r[4]),
    saldo_awal: Number(r[5]),
    sisa_saldo: Number(r[6]),
  }
}

export async function pingAPI(options?: FetchOptions): Promise<void> {
  try {
    await fetch(`${BASE_URL}?action=ping`, { cache: 'no-store', signal: options?.signal })
  } catch {
    // ignore — fire and forget
  }
}

export async function getBarangGrouped(options?: FetchOptions): Promise<BarangGrouped> {
  const res = await apiFetch(`${BASE_URL}?action=barang`, { cache: 'no-store', signal: options?.signal })
  const data: Record<KeluarType, unknown[][]> = await res.json()
  return {
    atk: (data.atk ?? []).map(parseBarangRow),
    rt: (data.rt ?? []).map(parseBarangRow),
    obat: (data.obat ?? []).map(parseBarangRow),
  }
}

export async function getBarang(type: KeluarType): Promise<Barang[]> {
  const res = await apiFetch(`${BASE_URL}?action=barang&type=${type}`, { cache: 'no-store' })
  const data: unknown[][] = await res.json()
  return data.map(parseBarangRow)
}

export async function getKeluar(type: KeluarType, month?: number, year?: number, options?: FetchOptions): Promise<Keluar[]> {
  let url = `${BASE_URL}?action=keluar&type=${type}`
  if (month && year) url += `&month=${month}&year=${year}`
  const res = await apiFetch(url, { cache: 'no-store', signal: options?.signal })
  const data: unknown[][] = await res.json()
  return data.map((r) => ({
    id: String(r[0]),
    id_barang: String(r[1]),
    kode_barang: String(r[2]),
    nama_barang: String(r[3]),
    merk: String(r[4]),
    satuan: String(r[5]),
    tanggal: parseDate(r[6]),
    qty: Number(r[7]),
    sisa_saldo: Number(r[8]),
    keterangan: String(r[9] ?? ''),
  }))
}

function postJSON(body: object) {
  return apiFetch(BASE_URL, {
    method: 'POST',
    // Content-Type: text/plain avoids CORS preflight for Google Apps Script
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
  })
}

export async function addKeluar(type: KeluarType, payload: Omit<Keluar, 'id' | 'sisa_saldo'>): Promise<void> {
  await postJSON({ ...payload, type, action: 'add' })
}

export async function addKeluarBatch(type: KeluarType, items: Omit<Keluar, 'id' | 'sisa_saldo'>[]): Promise<void> {
  if (items.length === 1) {
    await addKeluar(type, items[0])
    return
  }
  await postJSON({ items, type, action: 'addBatch' })
}

export async function updateKeluar(type: KeluarType, payload: Omit<Keluar, 'sisa_saldo'>): Promise<void> {
  await postJSON({ ...payload, type, action: 'update' })
}

export async function deleteKeluar(type: KeluarType, id: string): Promise<void> {
  await postJSON({ id, type, action: 'delete' })
}

export async function getStokData(month: number, year: number, options?: StokFetchOptions): Promise<StokItem[]> {
  // refresh=1 memaksa Apps Script menghitung ulang dari sheet, melewati cache-nya.
  const url = `${BASE_URL}?action=stok&month=${month}&year=${year}` + (options?.refresh ? '&refresh=1' : '')
  const res = await apiFetch(url, { cache: 'no-store', signal: options?.signal })
  const data: unknown = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((r) => parseStokRow(r))
}

// ─── Masuk ────────────────────────────────────────────────────────────────────

export interface Masuk {
  id: string
  id_barang: string
  kode_barang: string
  nama_barang: string
  merk: string
  satuan: string
  tanggal: string
  qty: number
  sisa_saldo: number
  keterangan: string
}

export async function getMasuk(type: KeluarType, month?: number, year?: number, options?: FetchOptions): Promise<Masuk[]> {
  let url = `${BASE_URL}?action=masuk&type=${type}`
  if (month && year) url += `&month=${month}&year=${year}`
  const res = await apiFetch(url, { cache: 'no-store', signal: options?.signal })
  const data: unknown[][] = await res.json()
  return data.map((r) => ({
    id: String(r[0]),
    id_barang: String(r[1]),
    kode_barang: String(r[2]),
    nama_barang: String(r[3]),
    merk: String(r[4]),
    satuan: String(r[5]),
    tanggal: parseDate(r[6]),
    qty: Number(r[7]),
    sisa_saldo: Number(r[8]),
    keterangan: String(r[9] ?? ''),
  }))
}

export async function addMasuk(type: KeluarType, payload: Omit<Masuk, 'id' | 'sisa_saldo'>): Promise<void> {
  await postJSON({ ...payload, type, action: 'addMasuk' })
}

export async function addMasukBatch(type: KeluarType, items: Omit<Masuk, 'id' | 'sisa_saldo'>[]): Promise<void> {
  if (items.length === 1) {
    await addMasuk(type, items[0])
    return
  }
  await postJSON({ items, type, action: 'addMasukBatch' })
}

export async function updateMasuk(type: KeluarType, payload: Omit<Masuk, 'sisa_saldo'>): Promise<void> {
  await postJSON({ ...payload, type, action: 'updateMasuk' })
}

export async function deleteMasuk(type: KeluarType, id: string): Promise<void> {
  await postJSON({ id, type, action: 'deleteMasuk' })
}

// ─── Barang CRUD ──────────────────────────────────────────────────────────────

export async function addBarang(type: KeluarType, payload: Omit<Barang, 'id' | 'sisa_saldo'>): Promise<void> {
  await postJSON({ ...payload, type, action: 'addBarang' })
}

export async function updateBarang(type: KeluarType, payload: Barang): Promise<void> {
  await postJSON({ ...payload, type, action: 'updateBarang' })
}

export async function deleteBarang(type: KeluarType, id: string): Promise<void> {
  await postJSON({ id, type, action: 'deleteBarang' })
}
