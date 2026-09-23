// framework
import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Inter } from 'next/font/google'

// components
import { Backdrop } from '@/components/layout/Backdrop'

import './globals.css'

// Inter for the interface; Geist Mono wherever digits must line up — phone
// numbers, counts, timestamps. Chosen over JetBrains Mono since it reads as
// data rather than code.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// Variable font: one file covers every weight, including the bold stat figures.
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

// Every tab reads "Operator Console | <where you are>". A page sets only its own
// name and the template adds the rest, so the pattern cannot drift page by page.
export const metadata: Metadata = {
  title: { default: 'Operator Console', template: 'Operator Console | %s' },
  description: 'WhatsApp line operations and messaging volume',
}

export const viewport: Viewport = {
  themeColor: '#f5f7fa',
  width: 'device-width',
  initialScale: 1,
}

/**
 * The document, typefaces and animated backdrop shared by every screen.
 * Deliberately no session check or sidebar — see app/(app)/layout.tsx for those.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh antialiased">
        <Backdrop />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
