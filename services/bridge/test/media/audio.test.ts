// Which audio must be transcoded before an agent can play it: WhatsApp voice notes
// are Opus in Ogg, which Apple players cannot open. Only the decision is tested.
// Run with: pnpm --filter @multiline/bridge test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// media
import { needsTranscode } from '../../src/media/audio.js'

describe('deciding whether audio has to be converted', () => {
  it('converts a voice note', () => {
    assert.equal(needsTranscode('audio/ogg', true), true)
  })

  it('converts a voice note even when WhatsApp sends no type at all', () => {
    // No mimetype is how the original silence happened: "unknown, probably fine"
    // let an Ogg voice note through untouched.
    assert.equal(needsTranscode(null, true), true)
  })

  it('converts a voice note that claims to be something playable', () => {
    // Held-to-talk recordings are Opus whatever the header says.
    assert.equal(needsTranscode('audio/mp4', true), true)
  })

  it('converts an attached ogg file, which fails on an iPhone the same way', () => {
    assert.equal(needsTranscode('audio/ogg', false), true)
  })

  it('converts opus, amr and 3gpp attachments', () => {
    for (const mimetype of ['audio/opus', 'audio/amr', 'audio/3gpp']) {
      assert.equal(needsTranscode(mimetype, false), true, mimetype)
    }
  })

  it('leaves an mp3 alone', () => {
    // A forwarded mp3 should arrive as the mp3, not a re-encode of it.
    assert.equal(needsTranscode('audio/mpeg', false), false)
  })

  it('leaves m4a, aac and wav alone', () => {
    for (const mimetype of ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/wav']) {
      assert.equal(needsTranscode(mimetype, false), false, mimetype)
    }
  })

  it('ignores the codec parameter WhatsApp appends', () => {
    assert.equal(needsTranscode('audio/ogg; codecs=opus', false), true)
    assert.equal(needsTranscode('audio/mpeg; charset=binary', false), false)
  })

  it('is not case sensitive', () => {
    assert.equal(needsTranscode('AUDIO/MPEG', false), false)
    assert.equal(needsTranscode('Audio/Ogg', false), true)
  })

  it('leaves anything that is not audio alone', () => {
    // A video or document reaching here is a caller bug; false keeps it out of ffmpeg.
    assert.equal(needsTranscode('video/mp4', false), false)
    assert.equal(needsTranscode('application/pdf', false), false)
    assert.equal(needsTranscode(null, false), false)
  })
})
