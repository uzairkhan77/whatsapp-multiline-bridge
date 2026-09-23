// framework
import Link from 'next/link'

/**
 * The frame the signed-out screens share: the mark, a heading, and one card.
 * Matches the login screen's markup so a reset link doesn't look like phishing.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center py-8 sm:px-8 sm:py-10">
      <main id="main" className="w-full max-w-[34rem]">
        <div className="reveal mb-6 px-4 text-center sm:px-0" style={{ ['--i' as string]: 0 }}>
          <Link
            href="/login"
            aria-label="Operator Console"
            className="bg-accent-gradient float mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-[var(--shadow-accent)] sm:h-16 sm:w-16"
          >
            S
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h1>
          <p className="mt-2 text-base font-medium text-muted">{description}</p>
        </div>

        <div
          className="card card-solid reveal overflow-hidden max-sm:rounded-none max-sm:border-x-0"
          style={{ ['--i' as string]: 1 }}
        >
          <div className="p-5 sm:p-9">{children}</div>
        </div>
      </main>
    </div>
  )
}
