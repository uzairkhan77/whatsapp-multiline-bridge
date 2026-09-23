// Converts inbound audio so a voice note plays on every device agents use,
// including iPhones: WebKit has no Ogg/Opus support, and Chatwoot has no
// conversion of its own (issue #13210). See docs/02-deployment.md.

// node
import { spawn } from 'node:child_process'

/**
 * MP3, not AAC: an MP4 needs a seekable output, which a pipe is not, and a
 * fragmented MP4 has playback quirks on the very player this exists to fix.
 */
export const TRANSCODED_MIMETYPE = 'audio/mpeg'
export const TRANSCODED_EXTENSION = 'mp3'

/** Audio subtypes Apple's players handle; anything else is converted. Compared on the subtype only. */
const APPLE_PLAYABLE = new Set(['mpeg', 'mp3', 'mp4', 'm4a', 'x-m4a', 'aac', 'wav', 'x-wav'])

/**
 * Whether the file must be converted before it plays everywhere. A voice note is
 * always converted (always Opus in practice, and may arrive without a mimetype);
 * an attached audio file only when its type is one Apple cannot open.
 */
export function needsTranscode(mimetype: string | null, isVoiceNote: boolean): boolean {
  if (isVoiceNote) return true
  if (!mimetype) return false

  const [type, rawSubtype] = mimetype.toLowerCase().split('/')
  if (type !== 'audio') return false

  // Parameters (`; codecs=opus`) are stripped again here: callers other than
  // describeInboundMedia may pass a raw value.
  const subtype = (rawSubtype ?? '').split(';')[0]!.trim()
  return !APPLE_PLAYABLE.has(subtype)
}

/** Longer than any voice note needs, short enough that a stuck process is noticed. */
const TRANSCODE_TIMEOUT_MS = 30_000

/**
 * Cap on ffmpeg output. A malformed or hostile file producing output without end
 * would otherwise fill the bridge's memory and take down every line at once.
 */
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024

export class TranscodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscodeError'
  }
}

/**
 * Convert audio to MP3 in memory: ffmpeg reads stdin and writes stdout, so nothing
 * touches the disk. `-vn` drops cover art, which ffmpeg cannot carry into an MP3 stream.
 */
export function toMp3(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        // Errors only: ffmpeg's default chatter arrives on stderr and looks like a fault.
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
        '-c:a', 'libmp3lame',
        // 64k mono is transparent for speech and keeps a minute under half a megabyte.
        '-b:a', '64k',
        '-ac', '1',
        '-f', 'mp3',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const chunks: Buffer[] = []
    let outputBytes = 0
    let stderr = ''
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ffmpeg.kill('SIGKILL')
      reject(error)
    }

    const timer = setTimeout(() => {
      fail(new TranscodeError(`ffmpeg did not finish within ${TRANSCODE_TIMEOUT_MS}ms`))
    }, TRANSCODE_TIMEOUT_MS)

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) {
        fail(new TranscodeError('ffmpeg produced more audio than the size limit allows'))
        return
      }
      chunks.push(chunk)
    })

    // Kept only to explain a failure ("Invalid data found when processing input"
    // is a broken file, not a broken install).
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString()
    })

    // Spawn failure (ffmpeg not installed or not executable) is reported as such:
    // the fix is different from a conversion failure.
    ffmpeg.on('error', (error) => {
      fail(new TranscodeError(`could not run ffmpeg: ${error.message}`))
    })

    ffmpeg.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code !== 0) {
        reject(new TranscodeError(`ffmpeg exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
        return
      }
      const output = Buffer.concat(chunks)
      if (output.byteLength === 0) {
        reject(new TranscodeError('ffmpeg produced no audio'))
        return
      }
      resolve(output)
    })

    // EPIPE when ffmpeg rejects the input and exits early; the close handler has
    // the real reason, this only stops the write error crashing the process.
    ffmpeg.stdin.on('error', () => {})
    ffmpeg.stdin.end(input)
  })
}

/**
 * Whether ffmpeg is installed, probed once at boot and remembered. Without it the
 * delivery path falls back to sending the original file.
 */
let availability: Promise<boolean> | null = null

export function ffmpegAvailable(): Promise<boolean> {
  availability ??= new Promise<boolean>((resolve) => {
    const probe = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    probe.on('error', () => resolve(false))
    probe.on('close', (code) => resolve(code === 0))
  })
  return availability
}
