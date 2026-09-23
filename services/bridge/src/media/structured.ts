// Shared contacts and shared locations: the WhatsApp messages that are neither
// text nor a file, described for Chatwoot. Pure translation, no I/O.
// See docs/02-deployment.md.

// media
import { unwrapMessage } from './media.js'
import { parseVCard, type SharedContact } from './vcard.js'

/** A pinned place, or a live location at the moment it was sent. */
export interface SharedLocation {
  latitude: number
  longitude: number
  /** What WhatsApp calls the place, when the sender picked one rather than dropping a pin. */
  name: string | null
  address: string | null
  /** A location that keeps updating as the sender moves; the coordinates are where they were when the message arrived. */
  isLive: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared contacts
// ─────────────────────────────────────────────────────────────────────────────

/** Shared contacts, both as the agent will read them and as they arrived. */
export interface SharedContacts {
  contacts: SharedContact[]
  /** The original cards byte for byte, ready to attach: they carry more (email, company, birthday) than the parsed fields. */
  vcard: string
}

/**
 * The contacts in a WhatsApp message, or null when it carries none. WhatsApp uses
 * `contactMessage` for one card and `contactsArrayMessage` for several; both are
 * unwrapped first, since a card in a disappearing message sits inside `ephemeralMessage`.
 */
export function describeSharedContacts(
  message: Record<string, unknown> | undefined,
): SharedContacts | null {
  const unwrapped = unwrapMessage(message)
  if (!unwrapped) return null

  const cards = rawCards(unwrapped)
  if (cards.length === 0) return null

  const contacts = cards
    .map((card) => parseVCard(card.vcard, card.displayName))
    .filter((contact): contact is SharedContact => contact !== null)

  if (contacts.length === 0) return null

  // Several cards concatenate: a .vcf file may hold more than one, and every address book reads them all.
  return { contacts, vcard: cards.map((card) => card.vcard.trim()).join('\n') }
}

/** The raw cards on a message, in the order they were sent. */
function rawCards(
  unwrapped: Record<string, unknown>,
): { vcard: string; displayName: string | null }[] {
  const name = (value: unknown): string | null => (typeof value === 'string' ? value : null)

  const single = unwrapped['contactMessage'] as
    | { displayName?: unknown; vcard?: unknown }
    | undefined
  if (single && typeof single.vcard === 'string') {
    return [{ vcard: single.vcard, displayName: name(single.displayName) }]
  }

  const many = unwrapped['contactsArrayMessage'] as
    | { contacts?: { displayName?: unknown; vcard?: unknown }[] }
    | undefined
  const entries = Array.isArray(many?.contacts) ? many.contacts : []

  return entries
    .filter(
      (entry): entry is { displayName?: unknown; vcard: string } =>
        typeof entry?.vcard === 'string',
    )
    .map((entry) => ({ vcard: entry.vcard, displayName: name(entry.displayName) }))
}

/**
 * What the agent reads in Chatwoot when a contact is shared. Plain lines, no
 * markup (Chatwoot renders asterisks as asterisks); one number per line so tapping
 * one on a phone selects only that number.
 */
export function contactsText(contacts: SharedContact[]): string {
  const heading = contacts.length === 1 ? 'Shared contact' : `Shared contacts (${contacts.length})`

  const blocks = contacts.map((contact) => {
    const lines = [contact.name]
    if (contact.phones.length > 0) {
      lines.push(...contact.phones)
    } else {
      // A card with no number is usually shared from an email-only entry; say so
      // rather than leave a lone name.
      lines.push('(no phone number on the card)')
    }
    return lines.join('\n')
  })

  return `${heading}\n\n${blocks.join('\n\n')}`
}

/**
 * A filename for the attached card: the person's name, reduced to characters
 * that are safe in a Content-Disposition header.
 */
export function contactFileName(contacts: SharedContact[]): string {
  const base =
    contacts.length === 1
      ? contacts[0]!.name
          .normalize('NFKD')
          // NFKD splits a letter from its accent; this drops the accent and keeps
          // the letter, so "José" becomes "jose", not "jos".
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^A-Za-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toLowerCase()
          .slice(0, 40)
      : 'contacts'

  return `${base || 'contact'}.vcf`
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared locations
// ─────────────────────────────────────────────────────────────────────────────

/** The place in a WhatsApp message, or null when it carries none. */
export function describeLocation(
  message: Record<string, unknown> | undefined,
): SharedLocation | null {
  const unwrapped = unwrapMessage(message)
  if (!unwrapped) return null

  const isLive = Boolean(unwrapped['liveLocationMessage'])
  const raw = (unwrapped['locationMessage'] ?? unwrapped['liveLocationMessage']) as
    | {
        degreesLatitude?: unknown
        degreesLongitude?: unknown
        name?: unknown
        address?: unknown
      }
    | undefined
  if (!raw) return null

  const latitude = Number(raw.degreesLatitude)
  const longitude = Number(raw.degreesLongitude)

  // Without usable coordinates there is no map link; the caller treats null as
  // "not a location". Zero is a real coordinate and is kept, even though it is
  // almost certainly a broken payload.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null

  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null

  return { latitude, longitude, name: text(raw.name), address: text(raw.address), isLive }
}

/**
 * Google's universal maps URL: opens the Google Maps app on Android, Apple Maps or
 * Google Maps on an iPhone, and the browser on a desktop.
 */
export function mapsUrl(location: SharedLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
}

/**
 * What the agent reads in Chatwoot when a place is shared. Name and address first;
 * the coordinates are only in the link.
 */
export function locationText(location: SharedLocation): string {
  const lines = [location.isLive ? 'Live location' : 'Shared location', '']

  if (location.name) lines.push(location.name)
  if (location.address) lines.push(location.address)
  // Only a pin is "a dropped pin"; a live location with no name is somebody moving.
  if (!location.name && !location.address && !location.isLive) {
    lines.push('A dropped pin.')
  }

  lines.push('', mapsUrl(location))

  if (location.isLive) {
    // The one thing an agent reading a live location later needs to know.
    lines.push('', 'This is where they were when the message arrived — they may have moved since.')
  }

  return lines.join('\n')
}
