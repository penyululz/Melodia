// Client-safe formatting utilities

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "0:00"

  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function formatBitrate(kbps: number | null): string {
  if (!kbps) return "Unknown"
  return `${kbps} kbps`
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return "Unknown"

  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

// Supported local media formats. Playback still depends on the browser/OS codec,
// but Melodia should ingest, serve, and label these formats consistently.
export const SUPPORTED_AUDIO_FORMATS = [
  // Lossy / common
  ".mp3",
  ".aac",
  ".ac3",
  ".eac3",
  ".m4a",
  ".ogg",
  ".oga",
  ".opus",
  ".wma",
  ".webm",
  ".mka",
  ".amr",
  ".caf",
  ".ra",
  // Hi-fi / lossless / raw-family containers
  ".flac",
  ".wav",
  ".wave",
  ".aiff",
  ".aif",
  ".alac",
  ".ape",
  ".wv",
  ".tta",
  ".tak",
  ".dsf",
  ".dff",
  ".pcm",
  ".raw",
]

export const SUPPORTED_VIDEO_FORMATS = [
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".wmv",
  ".divx",
  ".f4v",
  ".flv",
  ".mxf",
  ".ogv",
  ".rm",
  ".rmvb",
  ".vob",
  ".3gp",
  ".3g2",
  ".mpg",
  ".mpeg",
  ".m2v",
  ".ts",
  ".mts",
  ".m2ts",
]

export const SUPPORTED_SUBTITLE_FORMATS = [
  ".vtt",
  ".srt",
  ".ass",
  ".ssa",
  ".sbv",
]

export const SUPPORTED_FORMATS = [
  ...SUPPORTED_AUDIO_FORMATS,
  ...SUPPORTED_VIDEO_FORMATS,
]

const MEDIA_MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".ac3": "audio/ac3",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".alac": "audio/mp4",
  ".amr": "audio/amr",
  ".ape": "audio/ape",
  ".caf": "audio/x-caf",
  ".dff": "audio/dsd",
  ".dsf": "audio/dsd",
  ".eac3": "audio/eac3",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mka": "audio/x-matroska",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".ra": "audio/vnd.rn-realaudio",
  ".raw": "audio/L16",
  ".pcm": "audio/L16",
  ".tak": "audio/tak",
  ".tta": "audio/tta",
  ".wav": "audio/wav",
  ".wave": "audio/wav",
  ".webm": "video/webm",
  ".wma": "audio/x-ms-wma",
  ".wv": "audio/wavpack",
  ".3g2": "video/3gpp2",
  ".3gp": "video/3gpp",
  ".avi": "video/x-msvideo",
  ".divx": "video/x-msvideo",
  ".f4v": "video/mp4",
  ".flv": "video/x-flv",
  ".m2ts": "video/mp2t",
  ".m2v": "video/mpeg",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mxf": "application/mxf",
  ".mts": "video/mp2t",
  ".ogv": "video/ogg",
  ".rm": "application/vnd.rn-realmedia",
  ".rmvb": "application/vnd.rn-realmedia-vbr",
  ".ts": "video/mp2t",
  ".vob": "video/dvd",
  ".wmv": "video/x-ms-wmv",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".ass": "text/x-ssa",
  ".ssa": "text/x-ssa",
  ".sbv": "text/plain",
}

export const HOWLER_FORMATS = [
  "mp3",
  "mpeg",
  "opus",
  "ogg",
  "oga",
  "wav",
  "wave",
  "aac",
  "m4a",
  "mp4",
  "webm",
  "mka",
  "flac",
  "aiff",
  "aif",
]

export function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".")
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : ""
}

export function isAudioFile(filename: string): boolean {
  return SUPPORTED_AUDIO_FORMATS.includes(getFileExtension(filename))
}

export function isVideoFile(filename: string): boolean {
  return SUPPORTED_VIDEO_FORMATS.includes(getFileExtension(filename))
}

export function isMediaFile(filename: string): boolean {
  return SUPPORTED_FORMATS.includes(getFileExtension(filename))
}

export function isSubtitleFile(filename: string): boolean {
  return SUPPORTED_SUBTITLE_FORMATS.includes(getFileExtension(filename))
}

export function hasVideoExtension(track: { file_format?: string | null; file_path?: string } | null): boolean {
  const format = track?.file_format?.toLowerCase() || ""
  const filePath = track?.file_path || ""
  const videoContainerNames = [
    "mp4",
    "m4v",
    "quicktime",
    "matroska",
    "webm",
    "avi",
    "divx",
    "wmv",
    "flv",
    "mxf",
    "ogv",
    "realmedia",
    "3gp",
    "mpeg-ts",
    "m2ts",
    "vob",
  ]

  if (videoContainerNames.some((name) => format.includes(name))) {
    return true
  }

  return SUPPORTED_VIDEO_FORMATS.some((ext) => {
    const normalized = ext.slice(1)
    return format.includes(normalized) || getFileExtension(filePath) === ext
  })
}

export function getMediaMimeTypeFromPath(filePath: string): string {
  return MEDIA_MIME_TYPES[getFileExtension(filePath)] || "application/octet-stream"
}
