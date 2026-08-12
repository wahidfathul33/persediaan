import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { CACHE_TAG } from '../route'

/**
 * Buang cache proxy setelah aplikasi menulis ke spreadsheet.
 *
 * POST tetap dikirim langsung dari browser ke Apps Script (jalur itu sudah
 * terbukti jalan, dan meneruskannya lewat server justru bermasalah karena fetch
 * mengubah POST jadi GET saat mengikuti 302). Yang perlu dijembatani hanya
 * invalidasinya, dan itulah tugas endpoint ini.
 */
export async function POST() {
  // Next 16 mewajibkan profil masa berlaku. 'max' dipilih supaya entri dengan
  // revalidate terpanjang (bulan lampau, 1 jam) ikut terbuang, bukan hanya yang
  // berumur pendek.
  revalidateTag(CACHE_TAG, 'max')
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
