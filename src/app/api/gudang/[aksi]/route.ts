import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { revalidateTag } from 'next/cache'

import { CACHE_TAG } from '../../gas/route'
import { GUDANG_COOKIE, verifyGudangSession } from '@/lib/session'

/**
 * Penerus semua aksi menu Gudang ke Apps Script.
 *
 * Berbeda dari input admin yang POST langsung dari browser, aksi gudang selalu
 * lewat sini: sesi diperiksa, lalu GUDANG_SECRET ditambahkan di sisi server.
 * Apps Script menolak action "gudang*" tanpa secret itu, jadi URL /exec yang
 * terbaca di bundle JS tidak bisa dipakai untuk memanggilnya.
 *
 * POST server-ke-Apps Script dengan mengikuti redirect sudah terbukti jalan di
 * cron rollover, jadi pola yang sama dipakai di sini.
 */

const UPSTREAM = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

const AKSI: Record<string, { action: string; write: boolean }> = {
  anomali: { action: 'gudangAnomali', write: false },
  kartu: { action: 'gudangKartu', write: false },
  'snapshot-status': { action: 'gudangSnapshotStatus', write: false },
  log: { action: 'gudangLog', write: false },
  'simpan-kartu': { action: 'gudangSimpanKartu', write: true },
  'isi-snapshot': { action: 'gudangIsiSnapshot', write: true },
  rebuild: { action: 'gudangRebuild', write: true },
  'id-kembar': { action: 'gudangIdKembar', write: true },
  rollover: { action: 'gudangRollover', write: true },
  'bersihkan-cache': { action: 'gudangBersihkanCache', write: true },
}

// Hitung ulang semua saldo bisa memakan puluhan detik di Apps Script.
export const maxDuration = 60
const UPSTREAM_TIMEOUT_MS = 58000

export async function POST(request: NextRequest, { params }: { params: Promise<{ aksi: string }> }) {
  const session = await verifyGudangSession((await cookies()).get(GUDANG_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ status: 'error', message: 'Sesi gudang berakhir. Silakan login ulang.' }, { status: 401 })
  }

  const { aksi } = await params
  const def = AKSI[aksi]
  if (!def) return NextResponse.json({ status: 'error', message: `aksi tidak dikenal: ${aksi}` }, { status: 404 })

  const secret = process.env.GUDANG_SECRET
  if (!UPSTREAM || !secret) {
    return NextResponse.json({ status: 'error', message: 'API_URL / GUDANG_SECRET belum diisi di environment.' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  // action, secret, dan petugas ditulis SESUDAH isi dari browser supaya tidak
  // bisa ditimpa. Nama petugas untuk Log Gudang diambil dari sesi, bukan dari form.
  const payload = { ...body, action: def.action, gudangSecret: secret, petugas: session.nama }

  let result: { status?: string; message?: string; code?: number }
  try {
    const res = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Apps Script membalas HTTP ${res.status}`)
    result = await res.json()
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError'
      ? 'Apps Script tidak menjawab dalam 58 detik. Prosesnya mungkin tetap selesai; muat ulang untuk memeriksa.'
      : err instanceof Error ? err.message : 'Apps Script tidak bisa dihubungi.'
    return NextResponse.json({ status: 'error', message }, { status: 502 })
  }

  if (result?.status === 'error') {
    // 401 dari Apps Script berarti secret tidak cocok — itu salah konfigurasi
    // server, bukan sesi pengguna yang habis.
    if (result.code === 401) {
      return NextResponse.json({
        status: 'error',
        message: 'Apps Script menolak kunci gudang. Pastikan GUDANG_SECRET di Vercel sama dengan Script Properties.',
      }, { status: 502 })
    }
    const code = Number(result.code) || 400
    return NextResponse.json(result, { status: code >= 400 && code < 600 ? code : 400 })
  }

  // Data berubah: buang cache proxy baca supaya halaman admin langsung melihat angka baru.
  if (def.write) revalidateTag(CACHE_TAG, 'max')

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
