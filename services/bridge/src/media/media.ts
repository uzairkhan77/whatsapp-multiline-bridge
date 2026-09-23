// Describes a media message in the three vocabularies the bridge speaks: WhatsApp
// message keys (`imageMessage`, `documentMessage`, ...), Chatwoot file uploads,
// and Evolution's `mediatype` (image | video | audio | document, with voice notes
// on a separate endpoint). Pure translation, no I/O.

/**
 * WhatsApp wrappers around a message, not kinds of their own: `ephemeralMessage`
 * around an `imageMessage`, `documentWithCaptionMessage` around a `documentMessage`.
 * Kept in step with the list Evolution unwraps by, since it is what fetches the bytes.
 */
const WRAPPER_KEYS = [
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
] as const

/** Message keys that carry a file. Order decides ties, which in practice never happen. */
const MEDIA_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
] as const

export type MediaKey = (typeof MEDIA_KEYS)[number]

/** What Evolution's send endpoints call each kind. Voice notes go elsewhere entirely. */
export type EvolutionMediaType = 'image' | 'video' | 'audio' | 'document'

export interface InboundMedia {
  /** The WhatsApp message key the file was found under, after unwrapping. */
  key: MediaKey
  /** The words the customer typed alongside the file, if any. */
  caption: string | null
  mimetype: string | null
  /** Only documents carry a real name; everything else is named from its type. */
  fileName: string | null
  /** WhatsApp's own byte count, read before anything is downloaded. */
  fileLength: number | null
  /** A held-to-talk voice note (`ptt`) rather than an attached audio file; both arrive as `audioMessage`. */
  isVoiceNote: boolean
}

/**
 * Strip WhatsApp's wrappers until the message underneath is reached. Bounded so a
 * payload that wraps itself stops this function rather than the process.
 */
export function unwrapMessage(
  message: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  let current = message
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const wrapper = WRAPPER_KEYS.find((k) => current?.[k])
    if (!wrapper) return current
    const inner = (current[wrapper] as { message?: Record<string, unknown> } | undefined)?.message
    if (!inner) return current
    current = inner
  }
  return current
}

/** The file in a WhatsApp message, or null when the message carries none. */
export function describeInboundMedia(
  message: Record<string, unknown> | undefined,
): InboundMedia | null {
  const unwrapped = unwrapMessage(message)
  if (!unwrapped) return null

  const key = MEDIA_KEYS.find((k) => unwrapped[k])
  if (!key) return null

  const media = unwrapped[key] as {
    caption?: unknown
    mimetype?: unknown
    fileName?: unknown
    fileLength?: unknown
    ptt?: unknown
  }

  // fileLength arrives as a number, a numeric string, or protobuf's long (an
  // object with `low`/`high` halves). The long form is left as null: it only
  // shows up on files far past any limit, and a wrong guess is worse than not knowing.
  const rawLength = media.fileLength
  const fileLength =
    typeof rawLength === 'number'
      ? rawLength
      : typeof rawLength === 'string' && /^\d+$/.test(rawLength)
        ? Number(rawLength)
        : null

  const caption = typeof media.caption === 'string' && media.caption.trim() ? media.caption : null

  return {
    key,
    caption,
    mimetype: typeof media.mimetype === 'string' ? media.mimetype.split(';')[0]!.trim() : null,
    fileName: typeof media.fileName === 'string' && media.fileName ? media.fileName : null,
    fileLength,
    isVoiceNote: key === 'audioMessage' && media.ptt === true,
  }
}

/**
 * Extensions for the MIME types WhatsApp actually sends, so a file lands in Chatwoot
 * as `photo.jpg` rather than `photo`: an extensionless file is always a download.
 * Short on purpose; `extensionFor` falls back to the subtype for the rest.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
}

/** Names for kinds that have no name of their own, keyed by WhatsApp message key. */
const GENERIC_NAMES: Record<MediaKey, string> = {
  imageMessage: 'photo',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  ptvMessage: 'video-note',
}

/**
 * A filename for the file, invented from its kind and message id when WhatsApp
 * sent none. Only documents arrive named.
 */
export function inboundFileName(media: InboundMedia, messageId: string): string {
  if (media.fileName) return media.fileName

  const base = media.isVoiceNote ? 'voice-note' : GENERIC_NAMES[media.key]
  // The id is a value from outside: anything but a letter, digit, dash or
  // underscore is dropped before it reaches a Content-Disposition header.
  const suffix = messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)
  const extension = extensionFor(media.mimetype)

  return extension ? `${base}-${suffix}.${extension}` : `${base}-${suffix}`
}

/**
 * The file extension for a MIME type: the table first, then the subtype itself
 * for anything not in it (`image/heic` → `heic`).
 */
export function extensionFor(mimetype: string | null): string | null {
  if (!mimetype) return null

  const known = EXTENSIONS[mimetype.toLowerCase()]
  if (known) return known

  const subtype = mimetype.toLowerCase().split('/')[1]
  if (!subtype) return null

  // `vnd.openxmlformats-…` and friends are vendor identifiers, not extensions:
  // only a short, plain subtype is used as one.
  const cleaned = subtype.replace(/^x-/, '').split('+')[0] ?? ''
  return /^[a-z0-9]{1,5}$/.test(cleaned) ? cleaned : null
}

/**
 * How to describe the file in Chatwoot when the customer sent no caption. Only used
 * when the file could not be carried and a line of text stands in for it.
 */
export function mediaDescription(media: InboundMedia): string {
  if (media.isVoiceNote) return 'a voice note'
  switch (media.key) {
    case 'imageMessage':
      return 'a photo'
    case 'videoMessage':
      return 'a video'
    case 'ptvMessage':
      return 'a video note'
    case 'audioMessage':
      return 'an audio file'
    case 'stickerMessage':
      return 'a sticker'
    case 'documentMessage':
      return media.fileName ? `a document (${media.fileName})` : 'a document'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chatwoot → WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

/** An attachment as Chatwoot describes it on a message_created webhook. */
export interface ChatwootAttachment {
  data_url?: string
  file_type?: string
  file_size?: number
}

export interface OutboundMedia {
  url: string
  /** Which Evolution endpoint carries it, and as what. */
  mediatype: EvolutionMediaType
  /** Voice notes go through sendWhatsAppAudio so they arrive playable, not as a file. */
  asVoiceNote: boolean
  fileName: string
}

/**
 * Image types WhatsApp breaks by re-encoding to jpeg (an animated gif becomes a
 * still frame, an svg arrives broken). Sent as documents instead, as Evolution's
 * own Chatwoot integration does.
 */
const NOT_REALLY_IMAGES = new Set(['gif', 'svg', 'tiff', 'tif', 'dxf', 'dwg', 'bmp'])

/**
 * Work out how to send a Chatwoot attachment over WhatsApp. `file_type` is trusted
 * first; the extension decides when it is missing or says only "file". Returns
 * null only without a URL; every other unknown is sent as a document.
 */
export function describeOutboundMedia(attachment: ChatwootAttachment): OutboundMedia | null {
  const url = typeof attachment.data_url === 'string' ? attachment.data_url.trim() : ''
  if (!url) return null

  const fileName = fileNameFromUrl(url)
  const extension = (fileName.split('.').pop() ?? '').toLowerCase()
  const declared = (attachment.file_type ?? '').toLowerCase()

  // Audio changes the endpoint, not just `mediatype`, so it is decided first from either source.
  if (declared === 'audio' || isAudioExtension(extension)) {
    return { url, mediatype: 'audio', asVoiceNote: true, fileName }
  }

  if (declared === 'image' || isImageExtension(extension)) {
    const mediatype: EvolutionMediaType = NOT_REALLY_IMAGES.has(extension) ? 'document' : 'image'
    return { url, mediatype, asVoiceNote: false, fileName }
  }

  if (declared === 'video' || isVideoExtension(extension)) {
    return { url, mediatype: 'video', asVoiceNote: false, fileName }
  }

  return { url, mediatype: 'document', asVoiceNote: false, fileName }
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', ...NOT_REALLY_IMAGES])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', '3gp', 'mkv', 'avi', 'webm', 'm4v'])
const AUDIO_EXTENSIONS = new Set(['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac', 'amr', 'wav', 'flac'])

function isImageExtension(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension)
}
function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTENSIONS.has(extension)
}
function isAudioExtension(extension: string): boolean {
  return AUDIO_EXTENSIONS.has(extension)
}

/**
 * The filename at the end of a Chatwoot attachment URL. Evolution needs one for
 * documents: asked to send one with no name it regexes the URL itself and crashes
 * on no match. Query strings are cut first: Chatwoot Cloud signs its attachment URLs.
 */
export function fileNameFromUrl(url: string): string {
  // Parsed rather than split on slashes: a URL ending at its host has no name,
  // and splitting the whole string would hand back the hostname.
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    // Not a parseable URL: the text before any query string is the best guess left.
    path = url.split(/[?#]/)[0] ?? ''
  }

  const last = path.split('/').filter(Boolean).pop() ?? ''

  let decoded = last
  try {
    decoded = decodeURIComponent(last)
  } catch {
    // A stray percent sign in the URL. The undecoded name is still a usable name.
  }

  const cleaned = decoded.replace(/[\r\n"\\]/g, '').trim()
  return cleaned || 'attachment'
}
