import { NextResponse } from 'next/server'

/**
 * Cron job: Salin sisa_saldo → saldo_awal di sheet "List Barang"
 * Berjalan setiap hari pukul 19:00 UTC (= 02:00 WIB).
 * Proses rollover hanya dilakukan jika tanggal saat ini (WIB) adalah tanggal 1.
 *
 * Jadwal di vercel.json: "0 19 * * *"
 * Vercel mengirim header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  // ── 1. Verifikasi Vercel Cron Secret ───────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Cek apakah sekarang tanggal 1 (dalam zona waktu WIB / UTC+7) ────────
  const now = new Date()
  // Geser waktu ke WIB
  const wibDate = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const dayOfMonth = wibDate.getUTCDate() // pakai UTC setelah digeser manual

  if (dayOfMonth !== 1) {
    return NextResponse.json({
      status: 'skipped',
      message: `Bukan tanggal 1. Hari ini tanggal ${dayOfMonth} (WIB).`,
    })
  }

  // ── 3. Panggil Google Apps Script untuk rollover saldo ────────────────────
  const gasUrl = process.env.NEXT_PUBLIC_API_URL
  const rolloverSecret = process.env.ROLLOVER_SECRET

  if (!gasUrl || !rolloverSecret) {
    return NextResponse.json(
      { error: 'Konfigurasi server tidak lengkap (NEXT_PUBLIC_API_URL / ROLLOVER_SECRET)' },
      { status: 500 },
    )
  }

  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'rollover', cronSecret: rolloverSecret }),
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: `GAS merespons dengan status ${res.status}` },
      { status: 502 },
    )
  }

  const result: unknown = await res.json()

  return NextResponse.json({
    status: 'success',
    message: 'Rollover saldo berhasil dijalankan.',
    bulan: `${wibDate.getUTCMonth() + 1}/${wibDate.getUTCFullYear()}`,
    gasResponse: result,
  })
}
