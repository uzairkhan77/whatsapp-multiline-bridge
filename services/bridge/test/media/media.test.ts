// Reading a file out of a WhatsApp message, and working out how to send one back.
// The caption is the customer talking, so it must survive too.
// Run with: pnpm --filter @multiline/bridge test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// media
import {
  describeInboundMedia,
  describeOutboundMedia,
  extensionFor,
  fileNameFromUrl,
  inboundFileName,
  mediaDescription,
  unwrapMessage,
} from '../../src/media/media.js'

/** A photo as Evolution delivers one, with only the fields the bridge reads. */
function imageMessage(extra: Record<string, unknown> = {}) {
  return {
    imageMessage: {
      mimetype: 'image/jpeg',
      fileLength: '182344',
      ...extra,
    },
  }
}

describe('finding the file in an inbound message', () => {
  it('sees a photo', () => {
    const media = describeInboundMedia(imageMessage())
    assert.equal(media?.key, 'imageMessage')
    assert.equal(media?.mimetype, 'image/jpeg')
    assert.equal(media?.fileLength, 182344)
  })

  it('keeps the caption, which is the customer talking', () => {
    const media = describeInboundMedia(imageMessage({ caption: 'is this the one you meant?' }))
    assert.equal(media?.caption, 'is this the one you meant?')
  })

  it('treats a blank caption as no caption', () => {
    // WhatsApp sends an empty string rather than omitting the field. Carried
    // through as-is it becomes a blank Chatwoot message under the picture.
    assert.equal(describeInboundMedia(imageMessage({ caption: '   ' }))?.caption, null)
  })

  it('finds a photo inside a disappearing message', () => {
    const media = describeInboundMedia({ ephemeralMessage: { message: imageMessage() } })
    assert.equal(media?.key, 'imageMessage')
  })

  it('finds a document sent with a caption, which WhatsApp wraps', () => {
    const media = describeInboundMedia({
      documentWithCaptionMessage: {
        message: {
          documentMessage: {
            mimetype: 'application/pdf',
            fileName: 'quote-2026.pdf',
            caption: 'the quote you asked for',
          },
        },
      },
    })
    assert.equal(media?.key, 'documentMessage')
    assert.equal(media?.fileName, 'quote-2026.pdf')
    assert.equal(media?.caption, 'the quote you asked for')
  })

  it('finds a photo inside a view-once message', () => {
    const media = describeInboundMedia({ viewOnceMessageV2: { message: imageMessage() } })
    assert.equal(media?.key, 'imageMessage')
  })

  it('tells a voice note apart from an attached audio file', () => {
    const note = describeInboundMedia({ audioMessage: { mimetype: 'audio/ogg', ptt: true } })
    const file = describeInboundMedia({ audioMessage: { mimetype: 'audio/mpeg' } })
    assert.equal(note?.isVoiceNote, true)
    assert.equal(file?.isVoiceNote, false)
  })

  it('says there is no file when there is no file', () => {
    assert.equal(describeInboundMedia({ conversation: 'just words' }), null)
    assert.equal(describeInboundMedia(undefined), null)
    assert.equal(describeInboundMedia({}), null)
  })

  it('does not read a size it cannot trust', () => {
    // Protobuf's long arrives as { low, high }. The size decides whether a file is
    // downloaded at all, so a wrong guess is worse than not knowing.
    const media = describeInboundMedia(imageMessage({ fileLength: { low: 4, high: 0 } }))
    assert.equal(media?.fileLength, null)
  })

  it('stops rather than following a message that wraps itself forever', () => {
    const looping: Record<string, unknown> = {}
    looping['ephemeralMessage'] = { message: looping }
    assert.doesNotThrow(() => unwrapMessage(looping))
  })
})

describe('naming an inbound file', () => {
  it('keeps the name a document already has', () => {
    const media = describeInboundMedia({
      documentMessage: { mimetype: 'application/pdf', fileName: 'quote-2026.pdf' },
    })!
    assert.equal(inboundFileName(media, 'ABC123'), 'quote-2026.pdf')
  })

  it('names a photo after what it is, with an extension', () => {
    const media = describeInboundMedia(imageMessage())!
    assert.equal(inboundFileName(media, 'ABC123'), 'photo-ABC123.jpg')
  })

  it('calls a voice note a voice note', () => {
    const media = describeInboundMedia({ audioMessage: { mimetype: 'audio/ogg', ptt: true } })!
    assert.equal(inboundFileName(media, 'XYZ'), 'voice-note-XYZ.ogg')
  })

  it('strips anything odd out of the message id before using it as a name', () => {
    const media = describeInboundMedia(imageMessage())!
    assert.equal(inboundFileName(media, '../../etc/passwd'), 'photo-etcpasswd.jpg')
  })

  it('falls back to the subtype for a format not in the table', () => {
    assert.equal(extensionFor('image/heic'), 'heic')
  })

  it('does not turn a vendor identifier into an extension', () => {
    // `vnd.some-vendor.thing` is not an extension; a bare name is better.
    assert.equal(extensionFor('application/vnd.some-vendor.thing'), null)
  })

  it('ignores the charset WhatsApp sometimes appends to the type', () => {
    const media = describeInboundMedia(imageMessage({ mimetype: 'image/png; codecs=foo' }))
    assert.equal(media?.mimetype, 'image/png')
  })
})

describe('describing a file that could not be carried', () => {
  it('says what it was in words an agent can act on', () => {
    const photo = describeInboundMedia(imageMessage())!
    assert.equal(mediaDescription(photo), 'a photo')

    const note = describeInboundMedia({ audioMessage: { mimetype: 'audio/ogg', ptt: true } })!
    assert.equal(mediaDescription(note), 'a voice note')
  })

  it('names the document, since the name is the part worth asking about', () => {
    const doc = describeInboundMedia({
      documentMessage: { mimetype: 'application/pdf', fileName: 'quote-2026.pdf' },
    })!
    assert.equal(mediaDescription(doc), 'a document (quote-2026.pdf)')
  })
})

describe('sending a Chatwoot attachment back to WhatsApp', () => {
  it('sends a picture as a picture', () => {
    const media = describeOutboundMedia({
      data_url: 'https://chatwoot.example/rails/active_storage/blobs/abc/car.jpg',
      file_type: 'image',
    })
    assert.equal(media?.mediatype, 'image')
    assert.equal(media?.asVoiceNote, false)
    assert.equal(media?.fileName, 'car.jpg')
  })

  it('sends an audio file as a voice note so it plays in the chat', () => {
    const media = describeOutboundMedia({
      data_url: 'https://chatwoot.example/blobs/abc/reply.ogg',
      file_type: 'audio',
    })
    assert.equal(media?.asVoiceNote, true)
  })

  it('sends a gif as a document, because WhatsApp flattens it as an image', () => {
    const media = describeOutboundMedia({
      data_url: 'https://chatwoot.example/blobs/abc/loop.gif',
      file_type: 'image',
    })
    assert.equal(media?.mediatype, 'document')
  })

  it('works it out from the extension when Chatwoot only says "file"', () => {
    const video = describeOutboundMedia({
      data_url: 'https://chatwoot.example/blobs/abc/walkaround.mp4',
      file_type: 'file',
    })
    assert.equal(video?.mediatype, 'video')
  })

  it('falls back to a document, the one kind WhatsApp takes without understanding it', () => {
    const media = describeOutboundMedia({
      data_url: 'https://chatwoot.example/blobs/abc/contract.docx',
    })
    assert.equal(media?.mediatype, 'document')
    assert.equal(media?.fileName, 'contract.docx')
  })

  it('has nothing to send without a URL', () => {
    assert.equal(describeOutboundMedia({ file_type: 'image' }), null)
    assert.equal(describeOutboundMedia({ data_url: '  ' }), null)
  })

  it('always finds a filename, because Evolution throws on a document without one', () => {
    const media = describeOutboundMedia({ data_url: 'https://chatwoot.example/blobs/abc/' })
    assert.equal(media?.fileName, 'abc')
  })
})

describe('reading the filename out of an attachment URL', () => {
  it('drops the signature Chatwoot Cloud appends', () => {
    assert.equal(
      fileNameFromUrl('https://chatwoot.example/blobs/car.jpg?response-content-type=image%2Fjpeg'),
      'car.jpg',
    )
  })

  it('decodes a name that was escaped into the URL', () => {
    assert.equal(fileNameFromUrl('https://chatwoot.example/blobs/price%20list.pdf'), 'price list.pdf')
  })

  it('survives a stray percent sign rather than throwing', () => {
    assert.equal(fileNameFromUrl('https://chatwoot.example/blobs/100%.pdf'), '100%.pdf')
  })

  it('keeps quotes and newlines out of the name', () => {
    // The name goes into a multipart filename and Evolution's JSON; a quote or a
    // newline there is a header the receiver did not expect.
    assert.equal(fileNameFromUrl('https://chatwoot.example/blobs/od"d\nname.pdf'), 'oddname.pdf')
  })

  it('has a name to fall back on when the URL ends in nothing', () => {
    assert.equal(fileNameFromUrl('https://chatwoot.example/'), 'attachment')
  })
})
