import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { password } = await request.json()

  if (password !== process.env.OPERATOR_PASSWORD) {
    return NextResponse.json({ error: 'Password salah' }, { status: 401 })
  }

  const from = request.nextUrl.searchParams.get('from') || '/keluar'
  const response = NextResponse.json({ ok: true, redirect: from })
  response.cookies.set('keluar_auth', 'true', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 jam
  })
  return response
}
