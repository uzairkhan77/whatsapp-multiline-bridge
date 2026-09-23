// Reads a vCard (what WhatsApp sends for a shared contact) for the person's name
// and phone numbers. A real line parser, not a split on colons: a line can hold
// more than one colon (`URL:https://…`), and WhatsApp writes numbers as
// `item1.TEL;waid=34612345678:+34…`, a grouped property with parameters.

export interface SharedContact {
  /** The name as it should be shown. Never empty — falls back to the first number. */
  name: string
  /** Every number on the card, in the order they appear, de-duplicated. */
  phones: string[]
}

/**
 * Undo vCard line folding: a continuation line starts with a space or tab. Done
 * first so everything below can assume one property per line.
 */
function unfold(text: string): string[] {
  const lines: string[] = []
  // Handles \r\n, \n and a lone \r: the card comes from whichever phone the customer owns.
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (/^[ \t]/.test(raw) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
  }
  return lines
}

/**
 * Split one vCard line into its bare property name and its value. Split on the
 * first colon only; the name is stripped of its group prefix (`item1.`) and its
 * parameters (`;waid=…`, `;TYPE=CELL`). Returns null for a line with no colon.
 */
function splitLine(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(':')
  if (colon < 1) return null

  const left = line.slice(0, colon)
  const value = line.slice(colon + 1).trim()

  // Parameters first, then the group prefix: `item1.TEL;waid=…` must become `TEL`.
  const withoutParams = left.split(';')[0] ?? ''
  const withoutGroup = withoutParams.includes('.')
    ? withoutParams.slice(withoutParams.indexOf('.') + 1)
    : withoutParams

  return { name: withoutGroup.trim().toUpperCase(), value }
}

/**
 * `N:Gonzalez;Maria;;;` → `Maria Gonzalez`. `N` is the structured name (family,
 * given, middle, prefix, suffix), the fallback when the card has no `FN`.
 * Reassembled given-name-first, with empty fields dropped.
 */
function nameFromStructured(value: string): string {
  const [family = '', given = '', middle = ''] = value.split(';')
  return [given, middle, family]
    .map((part) => part.replace(/\\,/g, ',').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * Tidy a number for display without changing what it is. Deliberately not
 * normalised to E.164: it is somebody else's number, shown as shared, never routed on.
 */
function tidyPhone(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * The name and numbers on one vCard. `displayName` is WhatsApp's own label beside
 * the card, used when the card carries no usable name. Returns null only with no
 * name and no number.
 */
export function parseVCard(vcard: string, displayName?: string | null): SharedContact | null {
  const fullNames: string[] = []
  const structured: string[] = []
  const phones: string[] = []

  for (const line of unfold(vcard)) {
    const property = splitLine(line)
    if (!property || !property.value) continue

    if (property.name === 'FN') {
      fullNames.push(property.value.replace(/\\,/g, ',').trim())
    } else if (property.name === 'N') {
      structured.push(nameFromStructured(property.value))
    } else if (property.name === 'TEL') {
      const phone = tidyPhone(property.value)
      // The same number often appears twice, once bare and once in the `waid` form.
      if (phone && !phones.includes(phone)) phones.push(phone)
    }
  }

  // Preference: the card's `FN`, then its `N`, then WhatsApp's display name,
  // then the first number itself rather than a blank line.
  const name =
    fullNames.find(Boolean) ||
    structured.find(Boolean) ||
    (displayName ?? '').trim() ||
    phones[0] ||
    ''

  if (!name && phones.length === 0) return null

  return { name, phones }
}
