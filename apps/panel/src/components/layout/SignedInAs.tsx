// lib
import { signOut } from '@/app/login/actions'
import { currentUser } from '@/lib/auth'

// components
import { Icon } from '@/components/ui/icons'

/**
 * Signed-in user and sign-out control, shown in the sidebar footer on every
 * screen (not hidden in a menu) since this panel can disconnect a live number.
 */
// Server Component: sign-out posts to a Server Action, so it works even if the
// page's JavaScript has failed. `group-data-[collapsed]` classes below hide the
// text when the sidebar is an icon rail.
export async function SignedInAs() {
  const user = await currentUser()
  if (!user) return null

  const email = user.email ?? ''
  const initial = (email[0] ?? '?').toUpperCase()

  return (
    <div className="mt-1 flex items-center gap-2.5 rounded-xl bg-white/55 px-2 py-2 ring-1 ring-white/80 backdrop-blur-md group-data-[collapsed]:flex-col group-data-[collapsed]:px-1">
      <span
        aria-hidden="true"
        className="bg-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      >
        {initial}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-xs font-medium text-fg group-data-[collapsed]:hidden"
        title={email || undefined}
      >
        {email}
      </span>
      <form action={signOut}>
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          // Red on hover, not grey: this is the one destructive action here, and red
          // already means "undo" elsewhere in the app.
          className="text-muted inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:bg-danger-soft focus-visible:text-danger"
        >
          <Icon.Logout className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
