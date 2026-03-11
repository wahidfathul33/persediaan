const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export interface Barang {
  id: string
  kode_barang: string
  nama_barang: string
  merk: string
  uom: string
}

export interface Masuk {
  id: string
  id_barang: string
  kode_barang: string
  nama_barang: string
  merk: string
  uom: string
  tanggal: string
  qty: number
}

export interface Keluar {
  id: string
  id_barang: string
  kode_barang: string
  nama_barang: string
  merk: string
  uom: string
  tanggal: string
  qty: number
  keterangan: string
}

export interface StokItem {
  kode_barang: string
  nama_barang: string
  merk: string
  uom: string
  total_masuk: number
  total_keluar: number
  stok_akhir: number
}

function parseDate(val: unknown): string {
  if (!val) return ''
  const s = String(val)
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
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
    uom: String(r[4]),
  }))
}

export async function getMasuk(): Promise<Masuk[]> {
  const res = await apiFetch(`${BASE_URL}?action=masuk`, { cache: 'no-store' })
  const data: unknown[][] = await res.json()
  return data.map((r) => ({
    id: String(r[0]),
    id_barang: String(r[1]),
    kode_barang: String(r[2]),
    nama_barang: String(r[3]),
    merk: String(r[4]),
    uom: String(r[5]),
    tanggal: parseDate(r[6]),
    qty: Number(r[7]),
  }))
}

export async function getKeluar(): Promise<Keluar[]> {
  const res = await apiFetch(`${BASE_URL}?action=keluar`, { cache: 'no-store' })
  const data: unknown[][] = await res.json()
  return data.map((r) => ({
    id: String(r[0]),
    id_barang: String(r[1]),
    kode_barang: String(r[2]),
    nama_barang: String(r[3]),
    merk: String(r[4]),
    uom: String(r[5]),
    tanggal: parseDate(r[6]),
    qty: Number(r[7]),
    keterangan: String(r[8] ?? ''),
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

export async function addMasuk(payload: Omit<Masuk, 'id'>): Promise<void> {
  await postJSON({ ...payload, type: 'masuk', action: 'add' })
}

export async function updateMasuk(payload: Masuk): Promise<void> {
  await postJSON({ ...payload, type: 'masuk', action: 'update' })
}

export async function deleteMasuk(id: string): Promise<void> {
  await postJSON({ id, type: 'masuk', action: 'delete' })
}

export async function addKeluar(payload: Omit<Keluar, 'id'>): Promise<void> {
  await postJSON({ ...payload, type: 'keluar', action: 'add' })
}

export async function updateKeluar(payload: Keluar): Promise<void> {
  await postJSON({ ...payload, type: 'keluar', action: 'update' })
}

export async function deleteKeluar(id: string): Promise<void> {
  await postJSON({ id, type: 'keluar', action: 'delete' })
}

export async function getStokData(): Promise<StokItem[]> {
  const [masukList, keluarList, barangList] = await Promise.all([
    getMasuk(),
    getKeluar(),
    getBarang(),
  ])

  const stokMap: Record<string, StokItem> = {}

  masukList.forEach((m) => {
    const key = m.kode_barang
    if (!stokMap[key]) {
      const b = barangList.find((x) => x.kode_barang === m.kode_barang)
      stokMap[key] = {
        kode_barang: m.kode_barang,
        nama_barang: b?.nama_barang ?? m.nama_barang,
        merk: b?.merk ?? m.merk,
        uom: b?.uom ?? m.uom,
        total_masuk: 0,
        total_keluar: 0,
        stok_akhir: 0,
      }
    }
    stokMap[key].total_masuk += m.qty
  })

  keluarList.forEach((k) => {
    const key = k.kode_barang
    if (!stokMap[key]) {
      const b = barangList.find((x) => x.kode_barang === k.kode_barang)
      stokMap[key] = {
        kode_barang: k.kode_barang,
        nama_barang: b?.nama_barang ?? k.nama_barang,
        merk: b?.merk ?? k.merk,
        uom: b?.uom ?? k.uom,
        total_masuk: 0,
        total_keluar: 0,
        stok_akhir: 0,
      }
    }
    stokMap[key].total_keluar += k.qty
  })

  return Object.values(stokMap).map((s) => ({
    ...s,
    stok_akhir: s.total_masuk - s.total_keluar,
  }))
}
