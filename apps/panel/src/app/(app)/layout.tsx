// lib
import { requireUser } from '@/lib/auth'

// components
import { AppShell } from '@/components/layout/AppShell'
import { SignedInAs } from '@/components/layout/SignedInAs'

/**
 * Everything signed-in, and its chrome. requireUser() here is the auth boundary
 * for every page inside; pages call it too, since a Server Action bypasses layouts.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser()

  return <AppShell signedInAs={<SignedInAs />}>{children}</AppShell>
}
