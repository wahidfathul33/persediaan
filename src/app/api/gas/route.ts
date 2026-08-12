import { NextRequest, NextResponse } from 'next/server'

/**
 * Proxy pembacaan ke Google Apps Script, dengan cache di sisi server.
 *
 * Alasan keberadaannya, dari pengukuran terhadap deployment yang berjalan:
 *   hop /exec → 302 googleusercontent : 1,5–2,1 detik, konsisten
 *   stok cache HIT di Apps Script     : 2,0 detik  (payload 255 KB)
 *   ping 43 byte                      : 2,2 detik
 *
 * Payload 5.900x lebih kecil menghasilkan latensi yang sama, jadi biayanya bukan
 * di perhitungan maupun ukuran data — melainkan di dua round trip ke Google yang
 * tidak bisa dihilangkan dari sisi Apps Script. Cache di sini menghapus kedua hop
 * itu sepenuhnya untuk request yang berulang.
 *
 * Sekalian: retry 404 transien dikerjakan server-ke-server, jauh lebih murah
 * daripada di browser dan tidak memakan kuota koneksi paralel milik halaman.
 */

const UPSTREAM = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

// Hanya action baca yang diteruskan — mencegah endpoint ini dipakai sebagai
// relay terbuka ke spreadsheet.
const ALLOWED_ACTIONS = new Set(['ping', 'barang', 'keluar', 'masuk', 'stok'])
const ALLOWED_PARAMS = ['action', 'type', 'month', 'year', 'refresh'] as const

export const CACHE_TAG = 'gas'

// Setiap tulis lewat aplikasi memanggil /api/gas/revalidate, dan itu membuang
// cache untuk SEMUA sesi — bukan hanya sesi yang menginput. Jadi jendela di
// bawah ini tidak menahan input pengguna lain; yang tersisa hanyalah edit manual
// langsung di spreadsheet, yang jarang dan sudah punya jalan keluar lewat tombol
// Refresh (refresh=1).
//
// Karena itu jendelanya dibuat longgar. Nilai yang terlalu pendek justru merugikan:
// begitu kedaluwarsa, satu pengguna menanggung penuh latensi upstream — terukur
// 24 detik saat jendela 30 detik habis.
const REVALIDATE_PAST_MONTH = 3600
const REVALIDATE_CURRENT = 300

const RETRY_DELAYS_MS = [400, 1200]
const UPSTREAM_TIMEOUT_MS = 25000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isPastMonth(month: string | null, year: string | null): boolean {
  const m = Number(month)
  const y = Number(year)
  if (!m || !y) return false
  const now = new Date()
  return y * 100 + m < now.getFullYear() * 100 + (now.getMonth() + 1)
}

async function fetchUpstream(url: string, revalidate: number): Promise<Response> {
  let lastStatus = 0
  for (let i = 0; i < RETRY_DELAYS_MS.length + 1; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i - 1])
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        // revalidate: 0 berarti jangan simpan sama sekali (dipakai saat refresh=1).
        next: revalidate > 0 ? { revalidate, tags: [CACHE_TAG] } : { revalidate: 0 },
      })
      if (res.ok) return res
      lastStatus = res.status
    } catch {
      lastStatus = 0
    }
  }
  throw new Error(`upstream gagal (status terakhir ${lastStatus})`)
}

export async function GET(request: NextRequest) {
  if (!UPSTREAM) {
    return NextResponse.json({ status: 'error', message: 'API_URL belum diisi' }, { status: 500 })
  }

  const src = request.nextUrl.searchParams
  const action = src.get('action')
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ status: 'error', message: `action tidak diizinkan: ${action}` }, { status: 400 })
  }

  const forwarded = new URLSearchParams()
  for (const key of ALLOWED_PARAMS) {
    const value = src.get(key)
    if (value !== null) forwarded.set(key, value)
  }

  const refresh = src.get('refresh') === '1'
  const revalidate = refresh
    ? 0
    : isPastMonth(src.get('month'), src.get('year'))
      ? REVALIDATE_PAST_MONTH
      : REVALIDATE_CURRENT

  try {
    const upstream = await fetchUpstream(`${UPSTREAM}?${forwarded.toString()}`, revalidate)
    const body = await upstream.text()

    // no-store untuk browser: biarkan permintaan selalu sampai ke sini, lalu
    // dilayani dari Data Cache. Itu tetap menghapus kedua hop ke Google, tapi
    // memastikan revalidasi setelah input langsung terasa.
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { status: 'error', message: err instanceof Error ? err.message : 'upstream gagal' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
