import { isPhotoPlaceholder } from './message.js'

function decodedBytes(value) {
  return value ? Buffer.from(value, 'base64') : undefined
}

export function contentForStoredMessage(message) {
  if (!message) return null
  const media = message.media
  if (media && (media.kind === 'image' || media.kind === 'sticker')) {
    if (!media.mediaKey || !(media.directPath || media.url)) return null
    const node = {
      mimetype: media.mimetype,
      mediaKey: decodedBytes(media.mediaKey),
      directPath: media.directPath || undefined,
      url: media.url || undefined,
      fileEncSha256: decodedBytes(media.fileEncSha256),
      fileSha256: decodedBytes(media.fileSha256),
      fileLength: media.fileLength || undefined
    }
    if (media.kind === 'image' && message.text && !isPhotoPlaceholder(message.text))
      node.caption = message.text
    return media.kind === 'sticker' ? { stickerMessage: node } : { imageMessage: node }
  }
  if ((message.type === 'conversation' || message.type === 'extendedTextMessage') && message.text)
    return { conversation: message.text }
  return null
}

export function quotedMessageFor(message) {
  if (!message?.key?.id) return null
  const content = contentForStoredMessage(message)
    || (message.text ? { conversation: message.text } : null)
  return content ? { key: message.key, message: content } : null
}

export function forwardMessageFor(message) {
  if (!message?.key?.id) return null
  const content = contentForStoredMessage(message)
  return content ? { key: message.key, message: content } : null
}
