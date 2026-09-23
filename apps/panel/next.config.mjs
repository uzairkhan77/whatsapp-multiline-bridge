// Every service in this repo reads the one .env at the root, so the panel does too
// rather than keeping a second copy of the same credentials. next.config runs inside
// the Next server process, so what is loaded here is what Server Components and
// Server Actions see. Nothing here is exposed to the browser: no NEXT_PUBLIC_ prefix
// is used anywhere in this app, and the Evolution key can delete a live line.
//
// The import does the work: it reads .env and then whichever .env.backend.* file
// USE_LIVE_BACKEND selects. Shared with the bridge so both cannot end up pointed at
// different gateways — a panel reporting one gateway's line status while the bridge
// serves another is wrong in the most convincing possible way.
//
// On Vercel there is no .env and no .env.backend.*; the loader finds nothing, warns,
// and leaves the platform's own variables in place, which is the intended behaviour.
import '../../scripts/load-env.mjs'

/** @type {import('next').NextConfig} */
export default {
  // The gateway hands back profile pictures on WhatsApp's CDN. They are decoration;
  // if the host is unreachable the card falls back to initials rather than breaking.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.whatsapp.net' }],
  },

  experimental: {
    /*
      How long the browser may reuse a page it has already rendered when you
      navigate back to it. Next 15 dropped the default for dynamic pages to zero,
      which means every trip between Lines, Funnel and Settings re-rendered the
      whole page on the server — three remote services re-read to redraw a screen
      the browser was showing thirty seconds ago.

      Twenty seconds is deliberately shorter than the dashboard's own 15-second
      auto-refresh, so nothing on screen can be older than one refresh cycle:
      flicking between tabs is instant, staying on a tab still updates itself,
      and a hard refresh always goes to the server.

      The sidebar links prefetch (see Sidebar.tsx), so a tab you have not opened
      yet is fetched while you read the current one and lands under `static`.
    */
    staleTimes: { dynamic: 20, static: 120 },
  },
}
// No experimental runtime flag for src/proxy.ts: a proxy file always runs on Node,
// which is what lets it read the process.env populated above. See that file.
