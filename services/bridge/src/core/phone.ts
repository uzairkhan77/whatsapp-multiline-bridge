// Phone numbers and WhatsApp JIDs. Contacts are keyed on the number normalised to
// E.164, so the same customer reaching us on two lines is one contact, not two.

/**
 * WhatsApp addresses look like `14155550123@s.whatsapp.net`. `...@g.us` is a group
 * and `...@lid` is WhatsApp's privacy identifier (a stable id, not a number); neither
 * must be treated as a phone number. Evolution's `remoteJidAlt` is usually the real one.
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

export function isPhoneJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')
}

/** Prefer whichever of the candidate addresses is an actual phone number. */
export function pickAddressableJid(...candidates: (string | undefined | null)[]): string | null {
  const present = candidates.filter((c): c is string => typeof c === 'string' && c.length > 0)
  return present.find(isPhoneJid) ?? present.find((c) => !isGroupJid(c)) ?? null
}

/**
 * `14155550123@s.whatsapp.net` → `+14155550123`. A WhatsApp JID always carries a
 * country code, so `defaultCountryCode` is only reached for numbers typed on Chatwoot's side.
 */
export function toE164(input: string, defaultCountryCode = ''): string | null {
  const withoutDomain = input.split('@')[0] ?? ''
  // Multi-device JIDs carry a `:12` device suffix that is not part of the number.
  const withoutDevice = withoutDomain.split(':')[0] ?? ''
  let digits = withoutDevice.replace(/\D/g, '')

  if (digits.length === 0) return null

  if (input.trim().startsWith('+')) {
    return `+${digits}`
  }

  // A leading zero is a national trunk prefix, never part of the E.164 number.
  if (digits.startsWith('0') && defaultCountryCode) {
    digits = `${defaultCountryCode.replace(/\D/g, '')}${digits.slice(1)}`
  }

  // Shorter than this is a shortcode or a mangled value; inventing a country code
  // for it would create a contact that maps to the wrong person.
  if (digits.length < 8) return null

  return `+${digits}`
}

/** Evolution wants the bare digits, without the leading `+`. */
export function toEvolutionNumber(e164: string): string {
  return e164.replace(/\D/g, '')
}

/** The full JID Evolution's revoke endpoint needs, unlike sendText's bare digits. */
export function toWhatsAppJid(e164: string): string {
  return `${toEvolutionNumber(e164)}@s.whatsapp.net`
}
