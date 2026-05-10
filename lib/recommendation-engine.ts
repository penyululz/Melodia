import "server-only"

import type { NextRequest } from "next/server"
import db, { type Track, type YTTrack } from "@/lib/db"

type Signal = {
  historyCount: number
  completedCount: number
  skippedCount: number
  avgProgress: number
  liked: boolean
  disliked: boolean
  playlistCount: number
  searchScore: number
  similarUserScore: number
  playlistCoScore: number
  contextScore: number
}

type Affinity = {
  artists: Map<string, number>
  genres: Map<string, number>
  albums: Map<string, number>
  moods: Map<string, number>
  styles: Map<string, number>
  languages: Map<string, number>
  tempoBuckets: Map<string, number>
  titleTokens: Map<string, number>
}

export type RecommendationContext = {
  deviceType: "mobile" | "tablet" | "desktop"
  hour: number
  timeBucket: "morning" | "afternoon" | "evening" | "night"
}

export type TasteProfile = {
  userId: number | null
  context: RecommendationContext
  localSignals: Map<number, Signal>
  ytSignals: Map<string, Signal>
  affinity: Affinity
  searchTerms: Map<string, number>
}

type YouTubeSearchResult = {
  videoId: string
  title: string
  artist?: string | null
  album?: string | null
}

const EMPTY_SIGNAL: Signal = {
  historyCount: 0,
  completedCount: 0,
  skippedCount: 0,
  avgProgress: 0,
  liked: false,
  disliked: false,
  playlistCount: 0,
  searchScore: 0,
  similarUserScore: 0,
  playlistCoScore: 0,
  contextScore: 0,
}

export function buildTasteProfile(
  userId: number | null,
  localTracks: Track[],
  ytTracks: YTTrack[],
  request?: NextRequest
): TasteProfile {
  ensureRecommendationSchema()
  const signalUserId = getPersistableUserId(userId)
  const context = getRecommendationContext(request)
  const localSignals = new Map<number, Signal>()
  const ytSignals = new Map<string, Signal>()
  const searchTerms = getSearchTerms(signalUserId)

  addLocalHistorySignals(localSignals, signalUserId)
  addYouTubeHistorySignals(ytSignals, signalUserId)
  addFeedbackSignals(localSignals, ytSignals, signalUserId)
  addContextSignals(localSignals, ytSignals, signalUserId, context)
  if (signalUserId !== null) addSimilarUserSignals(localSignals, ytSignals, signalUserId)

  addPlaylistSignals(localSignals)
  addYouTubePlaylistSignals(ytSignals)
  addSearchSignals(localSignals, localTracks, searchTerms)
  addYouTubeSearchSignals(ytSignals, ytTracks, searchTerms)

  const affinity = buildAffinity(localTracks, ytTracks, localSignals, ytSignals)

  return {
    userId: signalUserId,
    context,
    localSignals,
    ytSignals,
    affinity,
    searchTerms,
  }
}

export function scoreLocalTrack(
  track: Track,
  profile: TasteProfile,
  mode: "direct" | "discover" | "recent" = "direct"
): number {
  const signal = getLocalSignal(profile, track.id)
  if (signal.disliked) return -1_000

  const artist = normalized(track.artist)
  const genre = normalized(track.genre)
  const album = normalized(track.album)
  const mood = normalized(getTrackMood(track))
  const style = normalized(getTrackStyle(track))
  const language = normalized(getTrackLanguage(track))
  const tempoBucket = getTempoBucket(getTrackTempo(track))
  const titleTokens = tokenize(track.title)
  const affinityScore =
    logWeight(artist ? profile.affinity.artists.get(artist) : 0) * 6 +
    logWeight(genre ? profile.affinity.genres.get(genre) : 0) * 8 +
    logWeight(album ? profile.affinity.albums.get(album) : 0) * 3 +
    logWeight(mood ? profile.affinity.moods.get(mood) : 0) * 7 +
    logWeight(style ? profile.affinity.styles.get(style) : 0) * 6 +
    logWeight(language ? profile.affinity.languages.get(language) : 0) * 2 +
    logWeight(profile.affinity.tempoBuckets.get(tempoBucket)) * 3 +
    titleTokens.reduce((sum, token) => sum + logWeight(profile.affinity.titleTokens.get(token)) * 0.7, 0)

  const directScore =
    signal.historyCount * 9 +
    signal.completedCount * 5 +
    signal.skippedCount * -18 +
    signal.avgProgress * 0.08 +
    track.play_count * 2.5 +
    (signal.liked ? 32 : 0) +
    (track.is_favorite ? 36 : 0) +
    signal.playlistCount * 7 +
    signal.searchScore * 3

  const similarityScore =
    affinityScore +
    signal.similarUserScore * 10 +
    signal.playlistCoScore * 7

  const contextScore = signal.contextScore * 6 + contextPreference(track, profile.context)
  const freshnessScore = freshnessBoost(track.created_at)

  if (mode === "discover") {
    return (
      similarityScore * 1.4 +
      signal.searchScore * 4 +
      contextScore +
      freshnessScore -
      signal.historyCount * 8 -
      signal.skippedCount * 10 -
      track.play_count * 0.8 +
      (track.is_favorite ? 5 : 0)
    )
  }

  if (mode === "recent") {
    return freshnessScore * 2 + similarityScore * 0.8 + directScore * 0.45 + contextScore
  }

  return directScore + similarityScore + contextScore + freshnessScore
}

export function scoreYouTubeTrack(track: YTTrack, profile: TasteProfile): number {
  const signal = getYouTubeSignal(profile, track.video_id)
  if (signal.disliked) return -1_000

  const artist = normalized(track.artist)
  const album = normalized(track.album)
  const style = "online-video"
  const titleTokens = tokenize(track.title)
  const affinityScore =
    logWeight(artist ? profile.affinity.artists.get(artist) : 0) * 6 +
    logWeight(album ? profile.affinity.albums.get(album) : 0) * 3 +
    logWeight(profile.affinity.styles.get(style)) * 3 +
    titleTokens.reduce((sum, token) => sum + logWeight(profile.affinity.titleTokens.get(token)) * 0.8, 0)

  return (
    signal.historyCount * 9 +
    signal.completedCount * 5 +
    signal.skippedCount * -18 +
    signal.avgProgress * 0.08 +
    track.play_count * 2.5 +
    (signal.liked ? 32 : 0) +
    (track.is_favorite ? 36 : 0) +
    (track.is_cached ? 18 : 0) +
    signal.playlistCount * 7 +
    signal.searchScore * 3 +
    signal.similarUserScore * 10 +
    signal.playlistCoScore * 7 +
    signal.contextScore * 6 +
    affinityScore +
    freshnessBoost(track.created_at)
  )
}

export function rankLocalSearchResults(
  tracks: Track[],
  query: string,
  profile: TasteProfile
): Track[] {
  return [...tracks].sort((a, b) => {
    const scoreA = scoreSearchableLocalTrack(a, query, profile)
    const scoreB = scoreSearchableLocalTrack(b, query, profile)
    return scoreB - scoreA || a.title.localeCompare(b.title)
  })
}

export function rankYouTubeSearchResults<T extends YouTubeSearchResult>(
  results: T[],
  query: string,
  profile: TasteProfile
): T[] {
  return [...results].sort((a, b) => {
    const scoreA = scoreSearchableYouTubeResult(a, query, profile)
    const scoreB = scoreSearchableYouTubeResult(b, query, profile)
    return scoreB - scoreA
  })
}

export function recordSearchSignal(
  userId: number | null,
  query: string,
  source: "all" | "local" | "youtube",
  resultCount: number,
  request?: NextRequest
) {
  ensureRecommendationSchema()
  if (request?.headers.get("x-melodia-pause-search-history") === "true") return
  if (!userId || query.trim().length < 2) return
  const persistedUserId = getPersistableUserId(userId)

  db.prepare(`
    INSERT INTO search_history (user_id, query, source, result_count, device_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(persistedUserId, query.trim().slice(0, 160), source, resultCount, getRecommendationContext(request).deviceType)
}

export function getPersistableUserId(userId: number | null | undefined): number | null {
  if (!userId) return null

  try {
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: number } | null
    return row?.id ?? null
  } catch {
    return null
  }
}

let schemaEnsured = false

function ensureRecommendationSchema() {
  if (schemaEnsured) return

  try {
    const columns = db.prepare("PRAGMA table_info(listen_history)").all() as { name: string }[]
    if (!columns.some((column) => column.name === "device_type")) {
      db.exec("ALTER TABLE listen_history ADD COLUMN device_type TEXT")
    }
    if (!columns.some((column) => column.name === "event_type")) {
      db.exec("ALTER TABLE listen_history ADD COLUMN event_type TEXT DEFAULT 'play'")
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        query TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'all',
        result_count INTEGER DEFAULT 0,
        device_type TEXT,
        searched_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query);
    `)
    schemaEnsured = true
  } catch (error) {
    console.warn("[recommendation-engine] Could not ensure recommendation schema:", error)
  }
}

export function getRecommendationContext(request?: NextRequest): RecommendationContext {
  const userAgent = request?.headers.get("user-agent")?.toLowerCase() ?? ""
  const hour = new Date().getHours()

  return {
    deviceType: userAgent.includes("ipad") || userAgent.includes("tablet")
      ? "tablet"
      : userAgent.includes("mobile") || userAgent.includes("android")
        ? "mobile"
        : "desktop",
    hour,
    timeBucket: getTimeBucket(hour),
  }
}

export function isDislikedLocal(trackId: number, profile: TasteProfile): boolean {
  return getLocalSignal(profile, trackId).disliked
}

export function isDislikedYouTube(videoId: string, profile: TasteProfile): boolean {
  return getYouTubeSignal(profile, videoId).disliked
}

function addLocalHistorySignals(signals: Map<number, Signal>, userId: number | null) {
  const rows = db.prepare(`
    SELECT
      track_id,
      COUNT(*) as historyCount,
      COALESCE(SUM(completed), 0) as completedCount,
      COALESCE(SUM(CASE WHEN event_type = 'skip' THEN 1 ELSE 0 END), 0) as skippedCount,
      COALESCE(AVG(progress_pct), 0) as avgProgress
    FROM listen_history
    WHERE user_id IS ? AND track_id IS NOT NULL
    GROUP BY track_id
  `).all(userId) as {
    track_id: number
    historyCount: number
    completedCount: number
    skippedCount: number
    avgProgress: number
  }[]

  for (const row of rows) {
    updateSignal(signals, row.track_id, {
      historyCount: Number(row.historyCount || 0),
      completedCount: Number(row.completedCount || 0),
      skippedCount: Number(row.skippedCount || 0),
      avgProgress: Number(row.avgProgress || 0),
    })
  }
}

function addYouTubeHistorySignals(signals: Map<string, Signal>, userId: number | null) {
  const rows = db.prepare(`
    SELECT
      yt_video_id,
      COUNT(*) as historyCount,
      COALESCE(SUM(completed), 0) as completedCount,
      COALESCE(SUM(CASE WHEN event_type = 'skip' THEN 1 ELSE 0 END), 0) as skippedCount,
      COALESCE(AVG(progress_pct), 0) as avgProgress
    FROM listen_history
    WHERE user_id IS ? AND yt_video_id IS NOT NULL
    GROUP BY yt_video_id
  `).all(userId) as {
    yt_video_id: string
    historyCount: number
    completedCount: number
    skippedCount: number
    avgProgress: number
  }[]

  for (const row of rows) {
    updateSignal(signals, row.yt_video_id, {
      historyCount: Number(row.historyCount || 0),
      completedCount: Number(row.completedCount || 0),
      skippedCount: Number(row.skippedCount || 0),
      avgProgress: Number(row.avgProgress || 0),
    })
  }
}

function addFeedbackSignals(
  localSignals: Map<number, Signal>,
  ytSignals: Map<string, Signal>,
  userId: number | null
) {
  const rows = db.prepare(`
    SELECT track_id, yt_video_id, action
    FROM track_feedback
    WHERE user_id IS ?
    ORDER BY updated_at DESC, created_at DESC
  `).all(userId) as { track_id: number | null; yt_video_id: string | null; action: string }[]

  const seenLocal = new Set<number>()
  const seenYouTube = new Set<string>()

  for (const row of rows) {
    const patch = {
      liked: row.action === "like",
      disliked: row.action === "dislike",
    }
    if (row.track_id && !seenLocal.has(row.track_id)) {
      updateSignal(localSignals, row.track_id, patch)
      seenLocal.add(row.track_id)
    }
    if (row.yt_video_id && !seenYouTube.has(row.yt_video_id)) {
      updateSignal(ytSignals, row.yt_video_id, patch)
      seenYouTube.add(row.yt_video_id)
    }
  }
}

function addPlaylistSignals(signals: Map<number, Signal>) {
  const rows = db.prepare(`
    SELECT track_id, COUNT(*) as playlistCount
    FROM playlist_tracks
    GROUP BY track_id
  `).all() as { track_id: number; playlistCount: number }[]

  for (const row of rows) {
    updateSignal(signals, row.track_id, { playlistCount: Number(row.playlistCount || 0) })
  }
}

function addYouTubePlaylistSignals(signals: Map<string, Signal>) {
  const rows = db.prepare(`
    SELECT video_id, SUM(playlistCount) as playlistCount
    FROM (
      SELECT t.video_id, COUNT(*) as playlistCount
      FROM yt_playlist_tracks pt
      JOIN yt_tracks t ON t.id = pt.yt_track_id
      GROUP BY t.video_id

      UNION ALL

      SELECT t.video_id, COUNT(*) as playlistCount
      FROM playlist_youtube_tracks pt
      JOIN yt_tracks t ON t.id = pt.yt_track_id
      GROUP BY t.video_id
    )
    GROUP BY video_id
  `).all() as { video_id: string; playlistCount: number }[]

  for (const row of rows) {
    updateSignal(signals, row.video_id, { playlistCount: Number(row.playlistCount || 0) })
  }
}

function addSearchSignals(
  signals: Map<number, Signal>,
  tracks: Track[],
  searchTerms: Map<string, number>
) {
  if (searchTerms.size === 0) return

  for (const track of tracks) {
    const score = scoreSearchMatch(
      [
        track.title,
        track.artist,
        track.album,
        track.genre,
        getTrackMood(track),
        getTrackStyle(track),
        getTrackLanguage(track),
      ].filter(Boolean).join(" "),
      searchTerms
    )
    if (score > 0) updateSignal(signals, track.id, { searchScore: score })
  }
}

function addYouTubeSearchSignals(
  signals: Map<string, Signal>,
  tracks: YTTrack[],
  searchTerms: Map<string, number>
) {
  if (searchTerms.size === 0) return

  for (const track of tracks) {
    const score = scoreSearchMatch(
      [track.title, track.artist, track.album].filter(Boolean).join(" "),
      searchTerms
    )
    if (score > 0) updateSignal(signals, track.video_id, { searchScore: score })
  }
}

function addSimilarUserSignals(
  localSignals: Map<number, Signal>,
  ytSignals: Map<string, Signal>,
  userId: number
) {
  const seedTrackIds = [...localSignals.entries()]
    .filter(([, signal]) => signal.historyCount > 0 || signal.liked)
    .map(([id]) => id)
    .slice(0, 50)
  const seedVideoIds = [...ytSignals.entries()]
    .filter(([, signal]) => signal.historyCount > 0 || signal.liked)
    .map(([id]) => id)
    .slice(0, 50)

  if (seedTrackIds.length > 0) {
    const placeholders = seedTrackIds.map(() => "?").join(",")
    const rows = db.prepare(`
      SELECT other.track_id, COUNT(*) as score
      FROM listen_history peer_seed
      JOIN listen_history other ON other.user_id = peer_seed.user_id
      WHERE peer_seed.user_id IS NOT NULL
        AND peer_seed.user_id != ?
        AND peer_seed.track_id IN (${placeholders})
        AND other.track_id IS NOT NULL
        AND other.track_id NOT IN (${placeholders})
      GROUP BY other.track_id
    `).all(userId, ...seedTrackIds, ...seedTrackIds) as { track_id: number; score: number }[]

    for (const row of rows) {
      updateSignal(localSignals, row.track_id, { similarUserScore: Number(row.score || 0) })
    }

    const playlistRows = db.prepare(`
      SELECT other.track_id, COUNT(*) as score
      FROM playlist_tracks seed
      JOIN playlist_tracks other ON other.playlist_id = seed.playlist_id
      WHERE seed.track_id IN (${placeholders})
        AND other.track_id NOT IN (${placeholders})
      GROUP BY other.track_id
    `).all(...seedTrackIds, ...seedTrackIds) as { track_id: number; score: number }[]

    for (const row of playlistRows) {
      updateSignal(localSignals, row.track_id, { playlistCoScore: Number(row.score || 0) })
    }
  }

  if (seedVideoIds.length > 0) {
    const placeholders = seedVideoIds.map(() => "?").join(",")
    const rows = db.prepare(`
      SELECT other.yt_video_id, COUNT(*) as score
      FROM listen_history peer_seed
      JOIN listen_history other ON other.user_id = peer_seed.user_id
      WHERE peer_seed.user_id IS NOT NULL
        AND peer_seed.user_id != ?
        AND peer_seed.yt_video_id IN (${placeholders})
        AND other.yt_video_id IS NOT NULL
        AND other.yt_video_id NOT IN (${placeholders})
      GROUP BY other.yt_video_id
    `).all(userId, ...seedVideoIds, ...seedVideoIds) as { yt_video_id: string; score: number }[]

    for (const row of rows) {
      updateSignal(ytSignals, row.yt_video_id, { similarUserScore: Number(row.score || 0) })
    }

    const playlistRows = db.prepare(`
      SELECT other_track.video_id, COUNT(*) as score
      FROM playlist_youtube_tracks seed
      JOIN yt_tracks seed_track ON seed_track.id = seed.yt_track_id
      JOIN playlist_youtube_tracks other ON other.playlist_id = seed.playlist_id
      JOIN yt_tracks other_track ON other_track.id = other.yt_track_id
      WHERE seed_track.video_id IN (${placeholders})
        AND other_track.video_id NOT IN (${placeholders})
      GROUP BY other_track.video_id
    `).all(...seedVideoIds, ...seedVideoIds) as { video_id: string; score: number }[]

    for (const row of playlistRows) {
      updateSignal(ytSignals, row.video_id, { playlistCoScore: Number(row.score || 0) })
    }
  }
}

function addContextSignals(
  localSignals: Map<number, Signal>,
  ytSignals: Map<string, Signal>,
  userId: number | null,
  context: RecommendationContext
) {
  const rows = db.prepare(`
    SELECT track_id, yt_video_id, device_type, listened_at
    FROM listen_history
    WHERE user_id IS ?
      AND (track_id IS NOT NULL OR yt_video_id IS NOT NULL)
    ORDER BY listened_at DESC
    LIMIT 500
  `).all(userId) as {
    track_id: number | null
    yt_video_id: string | null
    device_type: string | null
    listened_at: string
  }[]

  for (const row of rows) {
    const listenedHour = new Date(`${row.listened_at.replace(" ", "T")}Z`).getHours()
    let score = getTimeBucket(listenedHour) === context.timeBucket ? 1 : 0
    if (row.device_type && row.device_type === context.deviceType) score += 1
    if (score === 0) continue
    if (row.track_id) updateSignal(localSignals, row.track_id, { contextScore: score })
    if (row.yt_video_id) updateSignal(ytSignals, row.yt_video_id, { contextScore: score })
  }
}

function buildAffinity(
  localTracks: Track[],
  ytTracks: YTTrack[],
  localSignals: Map<number, Signal>,
  ytSignals: Map<string, Signal>
): Affinity {
  const affinity: Affinity = {
    artists: new Map(),
    genres: new Map(),
    albums: new Map(),
    moods: new Map(),
    styles: new Map(),
    languages: new Map(),
    tempoBuckets: new Map(),
    titleTokens: new Map(),
  }

  for (const track of localTracks) {
    const signal = getSignal(localSignals, track.id)
    const weight = getTasteWeight(signal, track.play_count, track.is_favorite)
    if (weight <= 0) continue
    increment(affinity.artists, track.artist, weight)
    increment(affinity.genres, track.genre, weight)
    increment(affinity.albums, track.album, weight * 0.5)
    increment(affinity.moods, getTrackMood(track), weight * 0.9)
    increment(affinity.styles, getTrackStyle(track), weight * 0.85)
    increment(affinity.languages, getTrackLanguage(track), weight * 0.45)
    incrementValue(affinity.tempoBuckets, getTempoBucket(getTrackTempo(track)), weight * 0.5)
    for (const token of tokenize(track.title)) {
      incrementValue(affinity.titleTokens, token, weight * 0.2)
    }
  }

  for (const track of ytTracks) {
    const signal = getSignal(ytSignals, track.video_id)
    const weight = getTasteWeight(signal, track.play_count, track.is_favorite)
    if (weight <= 0) continue
    increment(affinity.artists, track.artist, weight)
    increment(affinity.albums, track.album, weight * 0.5)
    increment(affinity.styles, "online-video", weight * 0.4)
    for (const token of tokenize(track.title)) {
      incrementValue(affinity.titleTokens, token, weight * 0.2)
    }
  }

  return affinity
}

function getSearchTerms(userId: number | null): Map<string, number> {
  const rows = db.prepare(`
    SELECT query, COUNT(*) as count, MAX(searched_at) as lastSearchedAt
    FROM search_history
    WHERE user_id IS ?
    GROUP BY LOWER(query)
    ORDER BY lastSearchedAt DESC
    LIMIT 40
  `).all(userId) as { query: string; count: number; lastSearchedAt: string }[]

  const terms = new Map<string, number>()
  for (const row of rows) {
    const ageDays = Math.max(0, (Date.now() - Date.parse(`${row.lastSearchedAt.replace(" ", "T")}Z`)) / 86_400_000)
    const recency = Number.isFinite(ageDays) ? Math.max(0.2, 1 - ageDays / 30) : 0.2
    for (const token of tokenize(row.query)) {
      incrementValue(terms, token, Number(row.count || 1) * recency)
    }
  }

  return terms
}

function scoreSearchableLocalTrack(track: Track, query: string, profile: TasteProfile): number {
  const base = textMatchScore(query, [
    track.title,
    track.artist,
    track.album,
    track.genre,
    getTrackMood(track),
    getTrackStyle(track),
    getTrackLanguage(track),
  ])
  return base * 100 + scoreLocalTrack(track, profile) * 0.15
}

function scoreSearchableYouTubeResult(
  result: YouTubeSearchResult,
  query: string,
  profile: TasteProfile
): number {
  const known = db.prepare("SELECT * FROM yt_tracks WHERE video_id = ?").get(result.videoId) as YTTrack | null
  const knownScore = known ? scoreYouTubeTrack(known, profile) * 0.2 : 0
  const artist = normalized(result.artist)
  const album = normalized(result.album)

  return (
    textMatchScore(query, [result.title, result.artist, result.album]) * 100 +
    knownScore +
    logWeight(artist ? profile.affinity.artists.get(artist) : 0) * 4 +
    logWeight(album ? profile.affinity.albums.get(album) : 0) * 2
  )
}

function textMatchScore(query: string, values: Array<string | null | undefined>): number {
  const haystack = values.filter(Boolean).join(" ").toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return 0
  if (haystack === normalizedQuery) return 5
  if (haystack.startsWith(normalizedQuery)) return 4
  if (haystack.includes(normalizedQuery)) return 3

  return tokenize(normalizedQuery).reduce(
    (score, token) => score + (haystack.includes(token) ? 1 : 0),
    0
  )
}

function getTasteWeight(signal: Signal, playCount: number, favorite: number): number {
  if (signal.disliked) return 0
  return (
    signal.historyCount * 5 +
    signal.completedCount * 3 +
    signal.skippedCount * -9 +
    signal.avgProgress * 0.04 +
    playCount +
    signal.searchScore * 1.5 +
    signal.playlistCount * 4 +
    (signal.liked ? 14 : 0) +
    (favorite ? 16 : 0)
  )
}

function contextPreference(track: Track, context: RecommendationContext): number {
  const text = [track.title, track.artist, track.album, track.genre, getTrackMood(track), getTrackStyle(track)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (context.timeBucket === "night" && /(night|sleep|lofi|chill|soft|ambient|r&b|sad)/.test(text)) return 5
  if (context.timeBucket === "morning" && /(morning|acoustic|bright|focus|coffee|wake)/.test(text)) return 3
  if (context.deviceType === "mobile" && /(single|radio|edit|remix|live)/.test(text)) return 2
  return 0
}

function getTrackMood(track: Track): string | null {
  return (track as Track & { mood?: string | null }).mood || inferMood(track)
}

function getTrackStyle(track: Track): string | null {
  return (track as Track & { style?: string | null }).style || normalized(track.genre)
}

function getTrackLanguage(track: Track): string | null {
  return (track as Track & { language?: string | null }).language || null
}

function getTrackTempo(track: Track): number | null {
  const tempo = Number((track as Track & { tempo?: number | null }).tempo)
  return Number.isFinite(tempo) && tempo > 0 ? tempo : null
}

function getTempoBucket(tempo: number | null): string {
  if (!tempo) return "unknown-tempo"
  if (tempo < 90) return "slow"
  if (tempo < 120) return "mid"
  if (tempo < 145) return "upbeat"
  return "fast"
}

function inferMood(track: Track): string | null {
  const text = [track.title, track.artist, track.album, track.genre].filter(Boolean).join(" ").toLowerCase()
  if (/(sleep|ambient|calm|soft|quiet|lofi|chill|rain|night)/.test(text)) return "chill"
  if (/(sad|heartbreak|lonely|blue|melancholy|emo)/.test(text)) return "sad"
  if (/(happy|sun|summer|party|dance|funk|disco)/.test(text)) return "upbeat"
  if (/(focus|study|work|deep)/.test(text)) return "focus"
  if (/(gym|run|workout|hard|trap|drill|metal)/.test(text)) return "energetic"
  return null
}

function freshnessBoost(createdAt: string): number {
  const ageDays = Math.max(0, (Date.now() - Date.parse(`${createdAt.replace(" ", "T")}Z`)) / 86_400_000)
  if (!Number.isFinite(ageDays)) return 0
  return Math.max(0, 30 - ageDays) * 0.35
}

function scoreSearchMatch(text: string, terms: Map<string, number>): number {
  const tokens = new Set(tokenize(text))
  let score = 0
  for (const [term, weight] of terms) {
    if (tokens.has(term) || text.toLowerCase().includes(term)) score += weight
  }
  return score
}

function getLocalSignal(profile: TasteProfile, id: number): Signal {
  return getSignal(profile.localSignals, id)
}

function getYouTubeSignal(profile: TasteProfile, id: string): Signal {
  return getSignal(profile.ytSignals, id)
}

function getSignal<T extends number | string>(signals: Map<T, Signal>, id: T): Signal {
  return signals.get(id) || EMPTY_SIGNAL
}

function updateSignal<T extends number | string>(
  signals: Map<T, Signal>,
  id: T,
  patch: Partial<Signal>
) {
  signals.set(id, {
    ...EMPTY_SIGNAL,
    ...(signals.get(id) || EMPTY_SIGNAL),
    ...patch,
  })
}

function increment(map: Map<string, number>, value: string | null, amount: number) {
  const key = normalized(value)
  if (!key) return
  incrementValue(map, key, amount)
}

function incrementValue(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) || 0) + amount)
}

function logWeight(value: number | undefined): number {
  return Math.log1p(Math.max(0, value || 0))
}

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLowerCase()
  return result || null
}

function tokenize(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
        .slice(0, 12)
    )
  )
}

function getTimeBucket(hour: number): RecommendationContext["timeBucket"] {
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 17) return "afternoon"
  if (hour >= 17 && hour < 22) return "evening"
  return "night"
}
