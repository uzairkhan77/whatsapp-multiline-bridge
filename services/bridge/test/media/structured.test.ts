// Shared contacts (vCards) and shared places. A live location is not a pin: the
// coordinates are where the sender was, not where they are.
// Run with: pnpm --filter @multiline/bridge test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// media
import {
  contactFileName,
  contactsText,
  describeLocation,
  describeSharedContacts,
  locationText,
  mapsUrl,
} from '../../src/media/structured.js'
import { parseVCard } from '../../src/media/vcard.js'

/** A contact card as WhatsApp actually writes one. */
function vcard(body: string): string {
  return ['BEGIN:VCARD', 'VERSION:3.0', body, 'END:VCARD'].join('\n')
}

describe('reading a contact card', () => {
  it('finds the name and the number', () => {
    const contact = parseVCard(
      vcard('FN:Maria Gonzalez\nitem1.TEL;waid=34612345678:+34 612 345 678'),
    )
    assert.equal(contact?.name, 'Maria Gonzalez')
    assert.deepEqual(contact?.phones, ['+34 612 345 678'])
  })

  it('keeps a value containing a second colon', () => {
    // Splitting on every colon breaks a URL into pieces and can mis-attribute
    // the number after it. The number is what has to survive.
    const contact = parseVCard(
      vcard('FN:Maria Gonzalez\nURL:https://example.com/maria\nTEL:+34 612 345 678'),
    )
    assert.deepEqual(contact?.phones, ['+34 612 345 678'])
  })

  it('finds every number on a card with several', () => {
    const contact = parseVCard(
      vcard(
        'FN:Maria Gonzalez\n' +
          'item1.TEL;waid=34612345678:+34 612 345 678\n' +
          'item2.TEL;type=WORK:+34 911 223 344',
      ),
    )
    assert.deepEqual(contact?.phones, ['+34 612 345 678', '+34 911 223 344'])
  })

  it('shows the same number once when the card lists it twice', () => {
    const contact = parseVCard(
      vcard('FN:Maria Gonzalez\nTEL:+34 612 345 678\nitem1.TEL;waid=34612345678:+34 612 345 678'),
    )
    assert.deepEqual(contact?.phones, ['+34 612 345 678'])
  })

  it('rejoins a number that was folded across two lines', () => {
    // A folded line continues with a leading space. The fold marker is not part
    // of the value, so the halves join directly: "+34 612 34" + "5 678".
    const contact = parseVCard(vcard('FN:Maria Gonzalez\nTEL:+34 612 34\n 5 678'))
    assert.deepEqual(contact?.phones, ['+34 612 345 678'])
  })

  it('builds a name from the structured field when there is no display name', () => {
    const contact = parseVCard(vcard('N:Gonzalez;Maria;;;\nTEL:+34 612 345 678'))
    assert.equal(contact?.name, 'Maria Gonzalez')
  })

  it('falls back to the name WhatsApp showed beside the card', () => {
    const contact = parseVCard(vcard('TEL:+34 612 345 678'), 'Maria (work)')
    assert.equal(contact?.name, 'Maria (work)')
  })

  it('falls back to the number itself rather than showing a blank name', () => {
    const contact = parseVCard(vcard('TEL:+34 612 345 678'))
    assert.equal(contact?.name, '+34 612 345 678')
  })

  it('keeps a contact that has a name but no number', () => {
    // The agent can see who was meant and ask for the number.
    const contact = parseVCard(vcard('FN:Maria Gonzalez\nEMAIL:maria@example.com'))
    assert.equal(contact?.name, 'Maria Gonzalez')
    assert.deepEqual(contact?.phones, [])
  })

  it('gives back nothing for a card with neither a name nor a number', () => {
    assert.equal(parseVCard(vcard('EMAIL:maria@example.com')), null)
  })

  it('handles windows line endings, which some phones write', () => {
    const contact = parseVCard(
      'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Maria Gonzalez\r\nTEL:+34 612 345 678\r\nEND:VCARD',
    )
    assert.equal(contact?.name, 'Maria Gonzalez')
    assert.deepEqual(contact?.phones, ['+34 612 345 678'])
  })
})

describe('finding shared contacts in a message', () => {
  it('sees one shared contact', () => {
    const shared = describeSharedContacts({
      contactMessage: {
        displayName: 'Maria Gonzalez',
        vcard: vcard('FN:Maria Gonzalez\nTEL:+34 612 345 678'),
      },
    })
    assert.equal(shared?.contacts.length, 1)
    assert.equal(shared?.contacts[0]?.name, 'Maria Gonzalez')
  })

  it('keeps the original card so it can be attached', () => {
    // The card carries more than we print (email, company); an agent saving it
    // should get what the customer sent.
    const shared = describeSharedContacts({
      contactMessage: {
        vcard: vcard('FN:Maria Gonzalez\nEMAIL:maria@example.com\nTEL:+34 612 345 678'),
      },
    })
    assert.match(shared?.vcard ?? '', /BEGIN:VCARD/)
    assert.match(shared?.vcard ?? '', /EMAIL:maria@example\.com/)
  })

  it('sees several contacts sent together', () => {
    const shared = describeSharedContacts({
      contactsArrayMessage: {
        contacts: [
          { vcard: vcard('FN:Maria Gonzalez\nTEL:+34 612 345 678') },
          { vcard: vcard('FN:Luis Ortega\nTEL:+34 600 111 222') },
        ],
      },
    })
    assert.equal(shared?.contacts.length, 2)
    assert.equal(shared?.contacts[1]?.name, 'Luis Ortega')
    // A .vcf may hold several cards and every address book reads them all.
    assert.equal((shared?.vcard.match(/BEGIN:VCARD/g) ?? []).length, 2)
  })

  it('finds a contact shared in a disappearing message', () => {
    const shared = describeSharedContacts({
      ephemeralMessage: {
        message: { contactMessage: { vcard: vcard('FN:Maria Gonzalez\nTEL:+34 612 345 678') } },
      },
    })
    assert.equal(shared?.contacts.length, 1)
  })

  it('gives back nothing for a message that carries no contact', () => {
    assert.equal(describeSharedContacts({ conversation: 'hello' }), null)
    assert.equal(describeSharedContacts(undefined), null)
  })

  it('gives back nothing when every card on the message is unreadable', () => {
    assert.equal(
      describeSharedContacts({ contactMessage: { vcard: vcard('EMAIL:maria@example.com') } }),
      null,
    )
  })
})

describe('what the agent reads for a shared contact', () => {
  it('puts the name first and each number on its own line', () => {
    const text = contactsText([
      { name: 'Maria Gonzalez', phones: ['+34 612 345 678', '+34 911 223 344'] },
    ])
    assert.equal(text, 'Shared contact\n\nMaria Gonzalez\n+34 612 345 678\n+34 911 223 344')
  })

  it('counts them when there is more than one', () => {
    const text = contactsText([
      { name: 'Maria Gonzalez', phones: ['+34 612 345 678'] },
      { name: 'Luis Ortega', phones: ['+34 600 111 222'] },
    ])
    assert.match(text, /^Shared contacts \(2\)/)
    assert.match(text, /Luis Ortega/)
  })

  it('says so when the card carried no number', () => {
    const text = contactsText([{ name: 'Maria Gonzalez', phones: [] }])
    assert.match(text, /no phone number on the card/)
  })

  it('uses no markup, because Chatwoot would show it as characters', () => {
    const text = contactsText([{ name: 'Maria Gonzalez', phones: ['+34 612 345 678'] }])
    assert.ok(!text.includes('*'), 'asterisks arrive as asterisks in Chatwoot')
    assert.ok(!text.includes('_'))
  })

  it('names the attached card after the person', () => {
    assert.equal(contactFileName([{ name: 'José Gonzalez', phones: [] }]), 'jose-gonzalez.vcf')
  })

  it('names the attachment for a batch without inventing a person', () => {
    assert.equal(
      contactFileName([
        { name: 'Maria Gonzalez', phones: [] },
        { name: 'Luis Ortega', phones: [] },
      ]),
      'contacts.vcf',
    )
  })

  it('still produces a usable filename for a name with nothing safe in it', () => {
    assert.equal(contactFileName([{ name: '???', phones: [] }]), 'contact.vcf')
  })
})

describe('finding a shared place in a message', () => {
  it('sees a dropped pin', () => {
    const place = describeLocation({
      locationMessage: { degreesLatitude: 40.4168, degreesLongitude: -3.7038 },
    })
    assert.equal(place?.latitude, 40.4168)
    assert.equal(place?.longitude, -3.7038)
    assert.equal(place?.isLive, false)
    assert.equal(place?.name, null)
  })

  it('keeps the name and address when the sender picked a place', () => {
    const place = describeLocation({
      locationMessage: {
        degreesLatitude: 40.4168,
        degreesLongitude: -3.7038,
        name: 'Puerta del Sol',
        address: 'Plaza de la Puerta del Sol, Madrid',
      },
    })
    assert.equal(place?.name, 'Puerta del Sol')
    assert.equal(place?.address, 'Plaza de la Puerta del Sol, Madrid')
  })

  it('tells a live location apart from a pin', () => {
    const place = describeLocation({
      liveLocationMessage: { degreesLatitude: 40.4168, degreesLongitude: -3.7038 },
    })
    assert.equal(place?.isLive, true)
  })

  it('reads coordinates sent as strings', () => {
    const place = describeLocation({
      locationMessage: { degreesLatitude: '40.4168', degreesLongitude: '-3.7038' },
    })
    assert.equal(place?.latitude, 40.4168)
  })

  it('gives back nothing when the coordinates are missing or impossible', () => {
    assert.equal(describeLocation({ locationMessage: {} }), null)
    assert.equal(
      describeLocation({ locationMessage: { degreesLatitude: 400, degreesLongitude: 0 } }),
      null,
    )
    assert.equal(describeLocation({ conversation: 'hello' }), null)
  })
})

describe('what the agent reads for a shared place', () => {
  it('builds a map link that opens on any device', () => {
    const url = mapsUrl({
      latitude: 40.4168,
      longitude: -3.7038,
      name: null,
      address: null,
      isLive: false,
    })
    assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=40.4168,-3.7038')
  })

  it('leads with the place name and ends with the link', () => {
    const text = locationText({
      latitude: 40.4168,
      longitude: -3.7038,
      name: 'Puerta del Sol',
      address: 'Plaza de la Puerta del Sol, Madrid',
      isLive: false,
    })
    assert.match(text, /^Shared location/)
    assert.match(text, /Puerta del Sol/)
    assert.match(text, /https:\/\/www\.google\.com\/maps/)
  })

  it('does not call a live location a dropped pin', () => {
    const text = locationText({
      latitude: 40.4168,
      longitude: -3.7038,
      name: null,
      address: null,
      isLive: true,
    })
    assert.ok(!text.includes('dropped pin'), 'somebody moving is not a pin')
  })

  it('says it is a dropped pin when there is no name or address', () => {
    const text = locationText({
      latitude: 40.4168,
      longitude: -3.7038,
      name: null,
      address: null,
      isLive: false,
    })
    assert.match(text, /dropped pin/)
  })

  it('warns that a live location has moved on', () => {
    const text = locationText({
      latitude: 40.4168,
      longitude: -3.7038,
      name: null,
      address: null,
      isLive: true,
    })
    assert.match(text, /^Live location/)
    assert.match(text, /may have moved since/)
  })
})
