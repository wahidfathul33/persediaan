import { cookies } from 'next/headers'

import GudangNav from '@/components/gudang/GudangNav'
import { GUDANG_COOKIE, verifyGudangSession } from '@/lib/session'

export default async function GudangLayout({ children }: { children: React.ReactNode }) {
  const session = await verifyGudangSession((await cookies()).get(GUDANG_COOKIE)?.value)

  return (
    <div className="min-h-screen bg-slate-50">
      <GudangNav nama={session?.nama ?? null} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  )
}
