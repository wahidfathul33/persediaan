import { NextRequest, NextResponse } from 'next/server'

import { GUDANG_COOKIE, GUDANG_SESSION_MAX_AGE, safeEqual, signGudangSession } from '@/lib/session'

/** Pesan konfigurasi, supaya kesalahan setup terlihat jelas saat pertama dipasang. */
function configError(): string | null {
  const gudang = process.env.GUDANG_PASSWORD
  if (!gudang) return 'GUDANG_PASSWORD belum diisi di environment.'
  if (!process.env.GUDANG_SECRET) return 'GUDANG_SECRET belum diisi di environment.'
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) return 'SESSION_SECRET belum diisi atau kurang dari 32 karakter.'

  // Login gudang harus benar-benar terpisah. Jika password-nya sama dengan admin
  // atau operator, siapa pun yang tahu password itu otomatis punya akses gudang.
  if (gudang === process.env.ADMIN_PASSWORD || gudang === process.env.OPERATOR_PASSWORD) {
    return 'GUDANG_PASSWORD harus berbeda dari password admin dan operator.'
  }
  return null
}

export async function POST(request: NextRequest) {
  const problem = configError()
  if (problem) return NextResponse.json({ error: problem }, { status: 500 })

  const { password, nama } = await request.json().catch(() => ({}))
  const namaBersih = String(nama ?? '').trim().replace(/\s+/g, ' ')
  if (namaBersih.length < 2 || namaBersih.length > 40) {
    return NextResponse.json({ error: 'Nama petugas wajib diisi (2–40 karakter).' }, { status: 400 })
  }
  if (!safeEqual(String(password ?? ''), process.env.GUDANG_PASSWORD!)) {
    return NextResponse.json({ error: 'Password salah' }, { status: 401 })
  }

  // Hanya terima tujuan di dalam aplikasi ini, bukan URL situs lain.
  const fromParam = request.nextUrl.searchParams.get('from') || ''
  const redirect = fromParam.startsWith('/') && !fromParam.startsWith('//') ? fromParam : '/gudang'

  const response = NextResponse.json({ ok: true, redirect })
  response.cookies.set(GUDANG_COOKIE, await signGudangSession(namaBersih, process.env.SESSION_SECRET!), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUDANG_SESSION_MAX_AGE,
  })
  return response
}
