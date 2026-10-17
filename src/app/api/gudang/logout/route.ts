import { NextResponse } from 'next/server'

import { GUDANG_COOKIE } from '@/lib/session'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(GUDANG_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
