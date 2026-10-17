/**
 * Sesi login Gudang yang ditandatangani (HMAC-SHA256).
 *
 * Cookie admin/operator hanya berisi "true", sehingga bisa dipalsukan lewat
 * DevTools. Menu Gudang bisa menulis ulang seluruh riwayat stok, jadi cookie-nya
 * berisi peran + nama petugas + waktu kedaluwarsa, lalu ditandatangani dengan
 * SESSION_SECRET. Tanpa secret itu, isi cookie tidak bisa dibuat atau diubah.
 *
 * Memakai Web Crypto supaya bisa dipanggil dari proxy.ts maupun route handler.
 */

export const GUDANG_COOKIE = 'gudang_session'
export const GUDANG_SESSION_MAX_AGE = 60 * 60 * 8 // 8 jam, sama dengan login admin

export interface GudangSession {
  role: 'gudang'
  nama: string
  exp: number
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))))
}

/** Perbandingan waktu-konstan, supaya password/tanda tangan tidak bisa ditebak per karakter. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function signGudangSession(nama: string, secret: string): Promise<string> {
  const payload: GudangSession = { role: 'gudang', nama, exp: Date.now() + GUDANG_SESSION_MAX_AGE * 1000 }
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  return `${body}.${await hmac(body, secret)}`
}

/** @returns sesi yang sah dan belum kedaluwarsa, atau null. */
export async function verifyGudangSession(token: string | undefined): Promise<GudangSession | null> {
  const secret = process.env.SESSION_SECRET
  if (!token || !secret) return null

  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  if (!safeEqual(sig, await hmac(body, secret))) return null

  try {
    const s = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
    if (s?.role !== 'gudang' || typeof s.exp !== 'number' || s.exp < Date.now()) return null
    return { role: 'gudang', nama: String(s.nama ?? ''), exp: s.exp }
  } catch {
    return null
  }
}
