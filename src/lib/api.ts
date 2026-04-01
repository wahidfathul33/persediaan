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
  kode_barang: string
  nama_barang: string
  merk: string
  satuan: string
  saldo_awal: number
  sisa_saldo: number
  total_pemakaian: number
  days_in_month: number
  keluar_per_tanggal: number[]
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

async function apiFetch(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

export async function getBarang(): Promise<Barang[]> {
  const res = await apiFetch(`${BASE_URL}?action=barang`, { cache: 'no-store' })
  const data: unknown[][] = await res.json()
  return data.map((r) => ({
    id: String(r[0]),
    kode_barang: String(r[1]),
    nama_barang: String(r[2]),
    merk: String(r[3]),
    satuan: String(r[4]),
    saldo_awal: Number(r[5]),
    sisa_saldo: Number(r[6]),
  }))
}

export async function getKeluar(type: KeluarType, month?: number, year?: number): Promise<Keluar[]> {
  let url = `${BASE_URL}?action=keluar&type=${type}`
  if (month && year) url += `&month=${month}&year=${year}`
  const res = await apiFetch(url, { cache: 'no-store' })
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

export async function updateKeluar(type: KeluarType, payload: Omit<Keluar, 'sisa_saldo'>): Promise<void> {
  await postJSON({ ...payload, type, action: 'update' })
}

export async function deleteKeluar(type: KeluarType, id: string): Promise<void> {
  await postJSON({ id, type, action: 'delete' })
}

export async function getStokData(month: number, year: number): Promise<StokItem[]> {
  const res = await apiFetch(`${BASE_URL}?action=stok&month=${month}&year=${year}`, { cache: 'no-store' })
  return res.json()
}
