import "server-only"
import * as mm from "music-metadata"
import path from "path"
import fs from "fs"
import crypto from "crypto"

import { isMediaFile } from "./format"

export interface ExtractedMetadata {
  title: string
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
  discNumber: number | null
  duration: number | null
  bitRate: number | null
  sampleRate: number | null
  format: string | null
  coverArt: Buffer | null
  coverArtMimeType: string | null
  lyricsPlain: string | null
  lyricsSynced: string | null
  mood: string | null
  tempo: number | null
  language: string | null
  style: string | null
  contentType: "music" | "podcast"
  podcastTitle: string | null
  podcastAuthor: string | null
  podcastEpisodeNumber: number | null
  podcastSeasonNumber: number | null
  podcastDescription: string | null
  podcastPublishedAt: string | null
  loudnessAdjustDb: number
  replaygainTrackGain: number | null
  replaygainAlbumGain: number | null
}

interface CoverArtOptions {
  allowOnlineLookup?: boolean
}

export function isAudioFile(filename: string): boolean {
  return isMediaFile(filename)
}

export async function extractMetadata(
  filePath: string
): Promise<ExtractedMetadata> {
  const stats = fs.statSync(filePath)
  const metadata = await mm.parseFile(filePath)

  const { common, format } = metadata

  // Extract cover art
  let coverArt: Buffer | null = null
  let coverArtMimeType: string | null = null

  if (common.picture && common.picture.length > 0) {
    const picture = common.picture[0]
    coverArt = Buffer.from(picture.data)
    coverArtMimeType = picture.format
  }

  // Get the first genre if array
  const genre = Array.isArray(common.genre)
    ? common.genre[0]
    : common.genre || null
  const title = common.title || path.basename(filePath, path.extname(filePath))
  const artist = common.artist || null
  const album = common.album || null
  const albumArtist = common.albumartist || null
  const tempo = normalizeTempo((common as any).bpm || (common as any).tempo)
  const language = normalizeLanguage((common as any).language || (common as any).languages?.[0])
  const lyrics = extractEmbeddedLyrics(common)
  const podcast = extractPodcastMetadata(common, filePath)
  const loudness = extractLoudnessMetadata(metadata)
  const contentType = detectLibraryContentType({
    title,
    artist,
    album,
    albumArtist,
    genre,
    fileName: path.basename(filePath),
    explicitPodcast: podcast.isPodcast,
  })
  const descriptors = deriveAudioDescriptors({
    title,
    artist,
    album,
    genre,
    tempo,
    language,
    fileName: path.basename(filePath),
  })

  return {
    title,
    artist,
    album,
    albumArtist,
    genre,
    year: common.year || null,
    trackNumber: common.track?.no || null,
    discNumber: common.disk?.no || null,
    duration: format.duration || null,
    bitRate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
    sampleRate: format.sampleRate || null,
    format: format.container || path.extname(filePath).slice(1).toUpperCase(),
    coverArt,
    coverArtMimeType,
    lyricsPlain: lyrics.plain,
    lyricsSynced: lyrics.synced,
    ...descriptors,
    contentType,
    podcastTitle: podcast.podcastTitle,
    podcastAuthor: podcast.podcastAuthor,
    podcastEpisodeNumber: podcast.podcastEpisodeNumber,
    podcastSeasonNumber: podcast.podcastSeasonNumber,
    podcastDescription: podcast.podcastDescription,
    podcastPublishedAt: podcast.podcastPublishedAt,
    ...loudness,
  }
}

export async function resolveCoverArt(
  metadata: Pick<
    ExtractedMetadata,
    "title" | "artist" | "album" | "genre" | "coverArt" | "coverArtMimeType"
  >,
  options: CoverArtOptions = {}
): Promise<string | null> {
  if (metadata.coverArt && metadata.coverArtMimeType) {
    return saveCoverArt(
      metadata.coverArt,
      metadata.coverArtMimeType,
      metadata.album || "Unknown Album",
      metadata.artist || "Unknown Artist"
    )
  }

  if (shouldLookupOnlineArtwork(options.allowOnlineLookup) && hasUsefulArtworkQuery(metadata)) {
    const remote = await findOnlineCoverArt(metadata).catch(() => null)
    if (remote) return remote
  }

  return generateCoverArt(metadata).catch(() => null)
}

export async function saveCoverArt(
  coverArt: Buffer,
  mimeType: string,
  albumName: string,
  artistName: string
): Promise<string> {
  // Create covers directory
  const coversDir = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "covers")
  if (!fs.existsSync(/* turbopackIgnore: true */ coversDir)) {
    fs.mkdirSync(/* turbopackIgnore: true */ coversDir, { recursive: true })
  }

  // Generate unique filename based on album/artist
  const hash = crypto
    .createHash("md5")
    .update(`${artistName}-${albumName}`)
    .digest("hex")
    .slice(0, 12)

  const filename = `${hash}.webp`
  const filePath = path.join(coversDir, filename)

  if (!fs.existsSync(/* turbopackIgnore: true */ filePath)) {
    const webp = await convertImageToWebp(coverArt).catch(() => null)
    if (webp) {
      fs.writeFileSync(filePath, webp)
    } else {
      const fallback = getCoverArtFallbackPath(coversDir, hash, mimeType)
      if (!fs.existsSync(/* turbopackIgnore: true */ fallback.filePath)) {
        fs.writeFileSync(fallback.filePath, coverArt)
      }
      return fallback.publicPath
    }
  }

  return `/covers/${filename}`
}

export async function saveRemoteImageAsWebp(
  imageUrl: string | null | undefined,
  key: string
): Promise<string | null> {
  if (!imageUrl) return null

  try {
    const response = await fetch(imageUrl)
    if (!response.ok) return null

    const bytes = Buffer.from(await response.arrayBuffer())
    const hash = crypto
      .createHash("md5")
      .update(key)
      .update(bytes.subarray(0, 4096))
      .digest("hex")
      .slice(0, 12)
    const coversDir = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "covers")
    fs.mkdirSync(/* turbopackIgnore: true */ coversDir, { recursive: true })

    const filePath = path.join(coversDir, `${hash}.webp`)
    if (!fs.existsSync(/* turbopackIgnore: true */ filePath)) {
      const webp = await convertImageToWebp(bytes)
      fs.writeFileSync(filePath, webp)
    }

    return `/covers/${hash}.webp`
  } catch {
    return null
  }
}

export async function generateCoverArt(
  metadata: Pick<ExtractedMetadata, "title" | "artist" | "album" | "genre">
): Promise<string> {
  const key = `${metadata.artist || "Unknown Artist"}-${metadata.album || metadata.title || "Unknown Album"}`
  const hash = crypto.createHash("md5").update(key).digest("hex").slice(0, 12)
  const coversDir = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "covers")
  fs.mkdirSync(/* turbopackIgnore: true */ coversDir, { recursive: true })

  const filePath = path.join(coversDir, `generated-${hash}.webp`)
  if (!fs.existsSync(/* turbopackIgnore: true */ filePath)) {
    const [primary, secondary] = getCoverColors(key)
    const title = escapeSvgText(shorten(metadata.album || metadata.title || "Untitled", 34))
    const artist = escapeSvgText(shorten(metadata.artist || "Unknown Artist", 34))
    const genre = escapeSvgText(shorten(metadata.genre || "Local Library", 24).toUpperCase())
    const svg = `
      <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${primary}"/>
            <stop offset="100%" stop-color="${secondary}"/>
          </linearGradient>
          <radialGradient id="light" cx="28%" cy="22%" r="65%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1024" height="1024" fill="url(#bg)"/>
        <rect width="1024" height="1024" fill="url(#light)"/>
        <circle cx="772" cy="256" r="168" fill="#000" opacity="0.14"/>
        <circle cx="248" cy="804" r="216" fill="#fff" opacity="0.10"/>
        <path d="M290 307h286v58H348v248c0 74-61 134-136 134-61 0-111-37-111-84 0-51 57-91 126-91 22 0 43 4 63 12V307zm286 0h58v282c0 74-61 134-136 134-61 0-111-37-111-84 0-51 57-91 126-91 22 0 43 4 63 12V307z" fill="#fff" opacity="0.22"/>
        <text x="80" y="780" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#fff" opacity="0.68">${genre}</text>
        <text x="80" y="850" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="800" fill="#fff">${title}</text>
        <text x="80" y="914" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="600" fill="#fff" opacity="0.78">${artist}</text>
      </svg>
    `
    const sharp = (await import("sharp")).default
    const webp = await sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer()
    fs.writeFileSync(filePath, webp)
  }

  return `/covers/generated-${hash}.webp`
}

export function deriveAudioDescriptors(input: {
  title: string | null
  artist?: string | null
  album?: string | null
  genre?: string | null
  tempo?: number | null
  language?: string | null
  fileName?: string | null
}): { mood: string | null; tempo: number | null; language: string | null; style: string | null } {
  const text = [
    input.title,
    input.artist,
    input.album,
    input.genre,
    input.fileName,
  ].filter(Boolean).join(" ").toLowerCase()
  const tempo = normalizeTempo(input.tempo)

  return {
    mood: detectMood(text, tempo),
    tempo,
    language: normalizeLanguage(input.language) || detectLanguageHint(text),
    style: detectStyle(text, input.genre),
  }
}

export function detectLibraryContentType(input: {
  title?: string | null
  artist?: string | null
  album?: string | null
  albumArtist?: string | null
  genre?: string | null
  fileName?: string | null
  explicitPodcast?: boolean
}): "music" | "podcast" {
  if (input.explicitPodcast) return "podcast"

  const text = [
    input.title,
    input.artist,
    input.album,
    input.albumArtist,
    input.genre,
    input.fileName,
  ].filter(Boolean).join(" ").toLowerCase()

  if (/(^|[\s._-])(podcast|podcasts|episode|episodes|interview|spoken word)([\s._-]|$)/.test(text)) {
    return "podcast"
  }

  return "music"
}

async function convertImageToWebp(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default
  return sharp(input)
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer()
}

function getCoverArtFallbackPath(
  coversDir: string,
  hash: string,
  mimeType: string
): { filePath: string; publicPath: string } {
  let ext = ".jpg"
  if (mimeType.includes("png")) ext = ".png"
  else if (mimeType.includes("gif")) ext = ".gif"
  else if (mimeType.includes("webp")) ext = ".webp"

  return {
    filePath: path.join(coversDir, `${hash}${ext}`),
    publicPath: `/covers/${hash}${ext}`,
  }
}

async function findOnlineCoverArt(
  metadata: Pick<ExtractedMetadata, "title" | "artist" | "album">
): Promise<string | null> {
  const audioDbCover = await findTheAudioDbCoverArt(metadata).catch(() => null)
  if (audioDbCover) return audioDbCover

  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_API_KEY
  const cx = process.env.GOOGLE_CUSTOM_SEARCH_CX || process.env.GOOGLE_CSE_ID
  if (!apiKey || !cx) return null

  const { getCachedJson, makeCacheKey, canSpendRequestBudget, spendQuota, setCachedJson } = await import("@/lib/api-cache")
  const provider = "google-custom-search"
  const budget = Number.parseInt(process.env.GOOGLE_CSE_DAILY_IMAGE_BUDGET || "25", 10)
  const perMinuteBudget = Number.parseInt(process.env.GOOGLE_CSE_REQUESTS_PER_MINUTE || "5", 10)
  const query = [
    metadata.artist,
    metadata.album && metadata.album !== "Unknown Album" ? metadata.album : metadata.title,
    "album cover",
  ].filter(Boolean).join(" ")
  const cacheKey = makeCacheKey("cover-search", [query])
  const cached = getCachedJson<{ imageUrl: string | null }>(cacheKey)
  if (cached) return saveRemoteImageAsWebp(cached.imageUrl, `cover-${query}`)

  if (!canSpendRequestBudget(
    provider,
    1,
    Number.isFinite(budget) ? budget : 25,
    Number.isFinite(perMinuteBudget) ? perMinuteBudget : 5
  )) return null

  const url = new URL("https://www.googleapis.com/customsearch/v1")
  url.searchParams.set("key", apiKey)
  url.searchParams.set("cx", cx)
  url.searchParams.set("q", query)
  url.searchParams.set("searchType", "image")
  url.searchParams.set("num", "1")
  url.searchParams.set("safe", "active")
  url.searchParams.set("imgSize", "large")

  const response = await fetch(url, { signal: AbortSignal.timeout(3500) })
  spendQuota(provider, 1)
  if (!response.ok) return null

  const data = await response.json()
  const imageUrl = data?.items?.[0]?.link || null
  setCachedJson(cacheKey, { imageUrl }, getArtworkCacheTtlSeconds())
  return saveRemoteImageAsWebp(imageUrl, `cover-${query}`)
}

async function findTheAudioDbCoverArt(
  metadata: Pick<ExtractedMetadata, "title" | "artist" | "album">
): Promise<string | null> {
  if (process.env.THEAUDIODB_ENABLED === "0") return null

  const artist = metadata.artist?.trim()
  const album = metadata.album?.trim()
  const title = metadata.title?.trim()
  if (!artist || artist === "Unknown Artist") return null
  if (!album && !title) return null

  const {
    canSpendRequestBudget,
    getCachedJson,
    makeCacheKey,
    setCachedJson,
    spendQuota,
  } = await import("@/lib/api-cache")
  const provider = "theaudiodb"
  const dailyBudget = parseEnvInt(process.env.THEAUDIODB_DAILY_REQUEST_BUDGET, 200)
  const perMinuteBudget = parseEnvInt(process.env.THEAUDIODB_REQUESTS_PER_MINUTE, 20)
  const cacheKey = makeCacheKey("theaudiodb-cover", [artist, album, title])
  const cached = getCachedJson<{ imageUrl: string | null }>(cacheKey)
  if (cached) return saveRemoteImageAsWebp(cached.imageUrl, `theaudiodb-${artist}-${album || title}`)

  if (!canSpendRequestBudget(provider, 1, dailyBudget, perMinuteBudget)) return null

  const imageUrl =
    (album && album !== "Unknown Album"
      ? await fetchTheAudioDbImage("searchalbum.php", { s: artist, a: album })
      : null) ||
    (title ? await fetchTheAudioDbImage("searchtrack.php", { s: artist, t: title }) : null)

  spendQuota(provider, 1)
  setCachedJson(cacheKey, { imageUrl }, getArtworkCacheTtlSeconds())
  return saveRemoteImageAsWebp(imageUrl, `theaudiodb-${artist}-${album || title}`)
}

async function fetchTheAudioDbImage(
  endpoint: string,
  params: Record<string, string>
): Promise<string | null> {
  const apiKey = process.env.THEAUDIODB_API_KEY || "123"
  const url = new URL(`https://www.theaudiodb.com/api/v1/json/${apiKey}/${endpoint}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.THEAUDIODB_USER_AGENT || "Melodia/0.1 (self-hosted music player)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(3500),
  })
  if (!response.ok) return null

  const data = await response.json()
  const album = Array.isArray(data?.album) ? data.album[0] : null
  const track = Array.isArray(data?.track) ? data.track[0] : null
  const imageUrl =
    album?.strAlbumThumb ||
    album?.strAlbumCDart ||
    track?.strTrackThumb ||
    track?.strMusicVidScreen1 ||
    null

  return preferMediumTheAudioDbImage(imageUrl)
}

function shouldLookupOnlineArtwork(allowOnlineLookup?: boolean): boolean {
  if (allowOnlineLookup === true) return true
  if (allowOnlineLookup === false) return false
  return process.env.ONLINE_ARTWORK_LOOKUP === "1"
}

function hasUsefulArtworkQuery(
  metadata: Pick<ExtractedMetadata, "title" | "artist" | "album">
): boolean {
  const artist = metadata.artist?.trim()
  const album = metadata.album?.trim()
  const title = metadata.title?.trim()
  if (!artist || artist === "Unknown Artist") return false
  return Boolean((album && album !== "Unknown Album") || title)
}

function getArtworkCacheTtlSeconds(): number {
  const days = Number.parseInt(process.env.ARTWORK_CACHE_TTL_DAYS || "30", 10)
  return Math.max(1, Number.isFinite(days) ? days : 30) * 86_400
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function preferMediumTheAudioDbImage(imageUrl: string | null): string | null {
  if (!imageUrl) return null
  if (/\/(?:thumb|preview|medium|small)\//.test(imageUrl)) return imageUrl
  return `${imageUrl}/medium`
}

function normalizeTempo(value: unknown): number | null {
  const tempo = Number(value)
  return Number.isFinite(tempo) && tempo >= 40 && tempo <= 260 ? Math.round(tempo) : null
}

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null
  const result = value.trim().toLowerCase().slice(0, 16)
  return result || null
}

function detectMood(text: string, tempo: number | null): string | null {
  if (/(sleep|ambient|calm|soft|quiet|lofi|chill|rain|night)/.test(text)) return "chill"
  if (/(sad|heartbreak|lonely|blue|melancholy|emo)/.test(text)) return "sad"
  if (/(happy|sun|summer|party|dance|funk|disco)/.test(text)) return "upbeat"
  if (/(focus|study|work|deep)/.test(text)) return "focus"
  if (/(gym|run|workout|hard|trap|drill|metal)/.test(text)) return "energetic"
  if (tempo && tempo < 90) return "chill"
  if (tempo && tempo > 135) return "energetic"
  return null
}

function detectStyle(text: string, genre?: string | null): string | null {
  const haystack = `${genre || ""} ${text}`.toLowerCase()
  if (/(r&b|soul|neo soul)/.test(haystack)) return "rnb"
  if (/(hip hop|rap|trap|drill)/.test(haystack)) return "hip-hop"
  if (/(electronic|edm|house|techno|synth|dance)/.test(haystack)) return "electronic"
  if (/(rock|metal|punk|grunge)/.test(haystack)) return "rock"
  if (/(folk|acoustic|singer songwriter)/.test(haystack)) return "acoustic"
  if (/(pop|k-pop|j-pop|indie)/.test(haystack)) return "pop"
  if (/(jazz|blues|classical)/.test(haystack)) return "classic"
  if (/(live|session|concert)/.test(haystack)) return "live"
  return normalizedGenre(genre)
}

function detectLanguageHint(text: string): string | null {
  if (/(k-pop|korean|seoul)/.test(text)) return "ko"
  if (/(j-pop|japanese|tokyo|anime)/.test(text)) return "ja"
  if (/(latin|reggaeton|espanol|espa\u00f1ol|spanish)/.test(text)) return "es"
  if (/(mandarin|c-pop|chinese)/.test(text)) return "zh"
  return null
}

function normalizedGenre(value?: string | null): string | null {
  const result = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return result || null
}

function extractEmbeddedLyrics(common: mm.ICommonTagsResult): { plain: string | null; synced: string | null } {
  const candidates = [
    ...(Array.isArray((common as any).lyrics) ? (common as any).lyrics : []),
    ...(Array.isArray((common as any).unsynchronisedLyrics) ? (common as any).unsynchronisedLyrics : []),
    ...(Array.isArray((common as any).synchronisedLyrics) ? (common as any).synchronisedLyrics : []),
  ]
    .map((item) => {
      if (typeof item === "string") return item
      if (typeof item?.text === "string") return item.text
      if (typeof item?.lyrics === "string") return item.lyrics
      return null
    })
    .filter((value): value is string => Boolean(value?.trim()))

  const synced = candidates.find((value) => /\[\d{1,2}:\d{2}(?:\.\d+)?\]/.test(value)) || null
  const plain = candidates.find((value) => value !== synced) || synced || null

  return {
    plain: plain?.trim() || null,
    synced: synced?.trim() || null,
  }
}

function extractPodcastMetadata(
  common: mm.ICommonTagsResult,
  filePath: string
): {
  isPodcast: boolean
  podcastTitle: string | null
  podcastAuthor: string | null
  podcastEpisodeNumber: number | null
  podcastSeasonNumber: number | null
  podcastDescription: string | null
  podcastPublishedAt: string | null
} {
  const raw = common as any
  const podcastTitle =
    firstString(raw.show, raw.podcast, raw.podcastTitle, raw.series, raw.album) || null
  const podcastAuthor =
    firstString(raw.podcastAuthor, raw.author, raw.artist, raw.albumartist) || null
  const podcastDescription =
    firstString(raw.description, raw.comment?.[0], raw.subtitle, raw.longDescription) || null
  const publishedAt =
    normalizeDateString(raw.releasedate || raw.originaldate || raw.date || raw.year) || null
  const episodeNumber = normalizePositiveInt(raw.episode, raw.episodeNumber, raw.track?.no)
  const seasonNumber = normalizePositiveInt(raw.season, raw.seasonNumber, raw.disk?.no)
  const isPodcast =
    Boolean(raw.podcast || raw.show || raw.episode || raw.episodeNumber || raw.season || raw.seasonNumber) ||
    detectLibraryContentType({
      title: raw.title,
      artist: raw.artist,
      album: raw.album,
      genre: Array.isArray(raw.genre) ? raw.genre[0] : raw.genre,
      fileName: path.basename(filePath),
    }) === "podcast"

  return {
    isPodcast,
    podcastTitle: isPodcast ? podcastTitle : null,
    podcastAuthor: isPodcast ? podcastAuthor : null,
    podcastEpisodeNumber: isPodcast ? episodeNumber : null,
    podcastSeasonNumber: isPodcast ? seasonNumber : null,
    podcastDescription: isPodcast ? podcastDescription : null,
    podcastPublishedAt: isPodcast ? publishedAt : null,
  }
}

function extractLoudnessMetadata(metadata: mm.IAudioMetadata): {
  loudnessAdjustDb: number
  replaygainTrackGain: number | null
  replaygainAlbumGain: number | null
} {
  const common = metadata.common as any
  const nativeTags = Object.values(metadata.native || {}).flat() as Array<{ id?: string; value?: unknown }>
  const findNativeGain = (names: string[]) => {
    const lowerNames = names.map((name) => name.toLowerCase())
    const tag = nativeTags.find((item) => lowerNames.includes(String(item.id || "").toLowerCase()))
    return parseGainDb(tag?.value)
  }
  const replaygainTrackGain =
    parseGainDb(common.replaygain_track_gain) ??
    parseGainDb(common.track_gain) ??
    findNativeGain(["REPLAYGAIN_TRACK_GAIN", "replaygain_track_gain", "track_gain"])
  const replaygainAlbumGain =
    parseGainDb(common.replaygain_album_gain) ??
    parseGainDb(common.album_gain) ??
    findNativeGain(["REPLAYGAIN_ALBUM_GAIN", "replaygain_album_gain", "album_gain"])
  const loudnessAdjustDb = clampGainDb(replaygainTrackGain ?? replaygainAlbumGain ?? 0)

  return {
    loudnessAdjustDb,
    replaygainTrackGain,
    replaygainAlbumGain,
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = Array.isArray(value) ? value[0] : value
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return null
}

function normalizePositiveInt(...values: unknown[]): number | null {
  for (const value of values) {
    const candidate = typeof value === "object" && value && "no" in value ? (value as any).no : value
    const number = Number(candidate)
    if (Number.isInteger(number) && number > 0) return number
  }
  return null
}

function normalizeDateString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseGainDb(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return clampGainDb(value)
  if (typeof value !== "string") return null

  const match = value.match(/[-+]?\d+(?:\.\d+)?/)
  if (!match) return null

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? clampGainDb(parsed) : null
}

function clampGainDb(value: number): number {
  return Math.min(12, Math.max(-12, Number(value.toFixed(2))))
}

function getCoverColors(key: string): [string, string] {
  const hash = crypto.createHash("md5").update(key).digest()
  const hue = hash[0] % 360
  const secondaryHue = (hue + 72 + (hash[1] % 96)) % 360
  return [
    `hsl(${hue}, 72%, 35%)`,
    `hsl(${secondaryHue}, 68%, 22%)`,
  ]
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trim()}...` : value
}
