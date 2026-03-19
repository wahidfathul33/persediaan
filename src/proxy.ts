import { NextRequest, NextResponse } from 'next/server'

const ADMIN_COOKIE = 'admin_auth'
const KELUAR_COOKIE = 'keluar_auth'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ─── Keluar auth ────────────────────────────────────────────────────────────
  if (pathname.startsWith('/keluar')) {
    const isLoggedIn = request.cookies.get(KELUAR_COOKIE)?.value === 'true'

    if (pathname === '/keluar/login' && isLoggedIn) {
      return NextResponse.redirect(new URL('/keluar', request.url))
    }

    if (pathname === '/keluar/login' || pathname.startsWith('/api/keluar/login')) {
      return NextResponse.next()
    }

    if (!isLoggedIn) {
      const loginUrl = new URL('/keluar/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }

    return NextResponse.next()
  }

  // ─── Admin auth ──────────────────────────────────────────────────────────────
  const auth = request.cookies.get(ADMIN_COOKIE)
  const isLoggedIn = auth?.value === 'true'

  if (pathname === '/admin/login' && isLoggedIn) {
    return NextResponse.redirect(new URL('/admin', request.url))
  }

  // Allow login page and login API through
  if (pathname === '/admin/login' || pathname.startsWith('/api/admin/login')) {
    return NextResponse.next()
  }

  if (!isLoggedIn) {
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/keluar/:path*'],
}
