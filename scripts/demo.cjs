#!/usr/bin/env node

const Database = require("better-sqlite3")
const fs = require("fs")
const path = require("path")
const demoData = require("../lib/demo-data.json")

const ROOT_DIR = path.resolve(__dirname, "..")
const DATA_DIR = path.join(ROOT_DIR, "data")
const DB_PATH = path.join(DATA_DIR, "music.db")
const DEMO_DIR = path.join(DATA_DIR, "demo")
const SAMPLE_RATE = 44100

// Tiny browser-playable MP4 fixture adapted from https://gist.github.com/dmlap/5643609.
const TINY_MP4_BASE64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAV/0TAAYdeBTXzg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAAPAAAAAAAAAAAAAAABAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAgAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAqAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgACABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs2V+WXAWyAAADAAIAAAMAYB4kSywBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACtwAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTQuNjMuMTA0"

const command = process.argv[2] || "status"

try {
  const db = openDb()

  if (command === "seed") {
    resetDemo(db, { quiet: true })
    seedDemo(db)
    printStatus(db)
  } else if (command === "reset") {
    resetDemo(db)
    printStatus(db)
  } else if (command === "status") {
    printStatus(db)
  } else if (command === "verify") {
    verifyDemo(db).then(
      () => printStatus(db),
      (error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    )
  } else {
    console.error(`Unknown demo command: ${command}`)
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  ensureSchema(db)
  ensureDemoColumns(db)
  return db
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      album_artist TEXT,
      genre TEXT,
      year INTEGER,
      track_number INTEGER,
      disc_number INTEGER,
      duration REAL,
      file_path TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      storage_kind TEXT DEFAULT 'unknown',
      storage_path TEXT,
      file_size INTEGER,
      file_format TEXT,
      bit_rate INTEGER,
      sample_rate INTEGER,
      cover_art_path TEXT,
      lyrics_plain TEXT,
      lyrics_synced TEXT,
      lyrics_source TEXT,
      mood TEXT,
      tempo INTEGER,
      language TEXT,
      style TEXT,
      content_type TEXT DEFAULT 'music',
      podcast_title TEXT,
      podcast_author TEXT,
      podcast_episode_number INTEGER,
      podcast_season_number INTEGER,
      podcast_description TEXT,
      podcast_published_at TEXT,
      loudness_adjust_db REAL DEFAULT 0,
      replaygain_track_gain REAL,
      replaygain_album_gain REAL,
      play_count INTEGER DEFAULT 0,
      last_played_at TEXT,
      is_favorite INTEGER DEFAULT 0,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      cover_image_path TEXT,
      is_smart INTEGER DEFAULT 0,
      smart_rules TEXT,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      is_demo INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS yt_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      duration INTEGER,
      thumbnail_url TEXT,
      content_type TEXT DEFAULT 'music',
      podcast_title TEXT,
      podcast_author TEXT,
      podcast_episode_number INTEGER,
      podcast_season_number INTEGER,
      podcast_description TEXT,
      podcast_published_at TEXT,
      loudness_adjust_db REAL DEFAULT 0,
      replaygain_track_gain REAL,
      replaygain_album_gain REAL,
      is_cached INTEGER DEFAULT 0,
      cached_file_path TEXT,
      play_count INTEGER DEFAULT 0,
      last_played_at TEXT,
      is_favorite INTEGER DEFAULT 0,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS yt_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      thumbnail_url TEXT,
      track_count INTEGER DEFAULT 0,
      last_synced_at TEXT DEFAULT (datetime('now')),
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS yt_playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      yt_playlist_id INTEGER NOT NULL,
      yt_track_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      is_demo INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (yt_playlist_id) REFERENCES yt_playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (yt_track_id) REFERENCES yt_tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS listen_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      track_id INTEGER,
      yt_video_id TEXT,
      source TEXT NOT NULL DEFAULT 'local',
      event_type TEXT DEFAULT 'play',
      completed INTEGER DEFAULT 0,
      progress_pct REAL DEFAULT 0,
      device_type TEXT,
      listened_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS track_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      track_id INTEGER,
      yt_video_id TEXT,
      source TEXT NOT NULL DEFAULT 'local',
      action TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

function ensureDemoColumns(db) {
  ensureColumn(db, "tracks", "storage_kind", "TEXT DEFAULT 'unknown'")
  ensureColumn(db, "tracks", "storage_path", "TEXT")
  ensureColumn(db, "tracks", "lyrics_plain", "TEXT")
  ensureColumn(db, "tracks", "lyrics_synced", "TEXT")
  ensureColumn(db, "tracks", "lyrics_source", "TEXT")
  ensureColumn(db, "tracks", "mood", "TEXT")
  ensureColumn(db, "tracks", "tempo", "INTEGER")
  ensureColumn(db, "tracks", "language", "TEXT")
  ensureColumn(db, "tracks", "style", "TEXT")
  ensureColumn(db, "tracks", "content_type", "TEXT DEFAULT 'music'")
  ensureColumn(db, "tracks", "podcast_title", "TEXT")
  ensureColumn(db, "tracks", "podcast_author", "TEXT")
  ensureColumn(db, "tracks", "podcast_episode_number", "INTEGER")
  ensureColumn(db, "tracks", "podcast_season_number", "INTEGER")
  ensureColumn(db, "tracks", "podcast_description", "TEXT")
  ensureColumn(db, "tracks", "podcast_published_at", "TEXT")
  ensureColumn(db, "tracks", "loudness_adjust_db", "REAL DEFAULT 0")
  ensureColumn(db, "tracks", "replaygain_track_gain", "REAL")
  ensureColumn(db, "tracks", "replaygain_album_gain", "REAL")
  ensureColumn(db, "yt_tracks", "content_type", "TEXT DEFAULT 'music'")
  ensureColumn(db, "yt_tracks", "podcast_title", "TEXT")
  ensureColumn(db, "yt_tracks", "podcast_author", "TEXT")
  ensureColumn(db, "yt_tracks", "podcast_episode_number", "INTEGER")
  ensureColumn(db, "yt_tracks", "podcast_season_number", "INTEGER")
  ensureColumn(db, "yt_tracks", "podcast_description", "TEXT")
  ensureColumn(db, "yt_tracks", "podcast_published_at", "TEXT")
  ensureColumn(db, "yt_tracks", "loudness_adjust_db", "REAL DEFAULT 0")
  ensureColumn(db, "yt_tracks", "replaygain_track_gain", "REAL")
  ensureColumn(db, "yt_tracks", "replaygain_album_gain", "REAL")
  ensureColumn(db, "listen_history", "event_type", "TEXT DEFAULT 'play'")
  ensureColumn(db, "listen_history", "device_type", "TEXT")
  for (const table of ["tracks", "playlists", "playlist_tracks", "yt_tracks", "yt_playlists", "yt_playlist_tracks"]) {
    ensureColumn(db, table, "is_demo", "INTEGER DEFAULT 0")
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name)
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function deriveDemoDescriptors(track) {
  const text = [track.title, track.artist, track.album, track.genre].filter(Boolean).join(" ").toLowerCase()
  let mood = null
  if (/(rain|midnight|night|small weather|quiet)/.test(text)) mood = "chill"
  else if (/(sun|coffee|dawn)/.test(text)) mood = "focus"
  else if (/(city|loop|synth|electronic)/.test(text)) mood = "energetic"
  else if (track.kind === "video") mood = "visual"

  let style = null
  if (/(r&b|soul)/.test(text)) style = "rnb"
  else if (/(electronic|synth|video)/.test(text)) style = track.kind === "video" ? "video" : "electronic"
  else if (/(folk|coffee|dawn)/.test(text)) style = "acoustic"
  else if (/(indie|pop)/.test(text)) style = "pop"
  else if (track.genre) style = String(track.genre).toLowerCase()

  return {
    mood,
    tempo: track.kind === "video" ? 120 : 72 + ((track.frequency || 220) % 82),
    language: "en",
    style,
  }
}

function seedDemo(db) {
  generateDemoMedia()

  const insertTrack = db.prepare(`
    INSERT OR IGNORE INTO tracks (
      title, artist, album, album_artist, genre, year, track_number, disc_number,
      duration, file_path, file_name, file_size, file_format, bit_rate, sample_rate,
      cover_art_path, mood, tempo, language, style, play_count, is_favorite, is_demo,
      content_type, podcast_title, podcast_author, podcast_episode_number, podcast_season_number,
      podcast_description, podcast_published_at, loudness_adjust_db, replaygain_track_gain,
      replaygain_album_gain, storage_kind, storage_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?)
  `)

  const demoTrackIds = new Map()
  for (const [index, track] of demoData.tracks.entries()) {
    const ext = track.kind === "video" ? ".mp4" : ".wav"
    const mediaKind = track.kind === "video" ? "video" : "audio"
    const absoluteFilePath = path.join(DEMO_DIR, mediaKind, `${track.slug}${ext}`)
    const filePath = `/api/demo/media/${mediaKind}/${track.slug}${ext}`
    const createdAt = new Date(Date.now() - index * 86400000).toISOString()
    const stat = fs.statSync(absoluteFilePath)
    const descriptors = deriveDemoDescriptors(track)

    insertTrack.run(
      track.title,
      track.artist,
      track.album,
      track.albumArtist,
      track.genre,
      track.year,
      track.trackNumber,
      1,
      track.duration,
      filePath,
      `${track.slug}${ext}`,
      stat.size,
      track.kind === "video" ? "MP4" : "WAV",
      track.kind === "video" ? null : 705,
      track.kind === "video" ? null : SAMPLE_RATE,
      null,
      descriptors.mood,
      descriptors.tempo,
      descriptors.language,
      descriptors.style,
      track.playCount,
      track.isFavorite ? 1 : 0,
      track.contentType || "music",
      track.podcastTitle || null,
      track.podcastAuthor || null,
      track.podcastEpisodeNumber || null,
      track.podcastSeasonNumber || null,
      track.podcastDescription || null,
      track.podcastPublishedAt || null,
      0,
      null,
      null,
      absoluteFilePath,
      createdAt,
      createdAt
    )

    const row = db.prepare("SELECT id FROM tracks WHERE file_path = ?").get(filePath)
    if (row) demoTrackIds.set(track.slug, row.id)
  }

  seedPlaylists(db, demoTrackIds)
  seedYouTubeTracks(db)
  seedDemoActivity(db, demoTrackIds)
}

function seedPlaylists(db, demoTrackIds) {
  const insertPlaylist = db.prepare(`
    INSERT INTO playlists (name, description, is_demo, created_at, updated_at)
    VALUES (?, ?, 1, datetime('now'), datetime('now'))
  `)
  const insertPlaylistTrack = db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position, is_demo)
    VALUES (?, ?, ?, 1)
  `)

  for (const playlist of demoData.playlists) {
    const result = insertPlaylist.run(playlist.name, playlist.description)
    const playlistId = Number(result.lastInsertRowid)

    for (const [index, slug] of playlist.trackSlugs.entries()) {
      const trackId = demoTrackIds.get(slug)
      if (trackId) insertPlaylistTrack.run(playlistId, trackId, index + 1)
    }
  }
}

function seedYouTubeTracks(db) {
  const ytDemoDir = path.join(DEMO_DIR, "youtube")
  fs.mkdirSync(ytDemoDir, { recursive: true })

  const insertYTTrack = db.prepare(`
    INSERT OR IGNORE INTO yt_tracks (
      video_id, title, artist, album, duration, thumbnail_url, is_cached,
      cached_file_path, play_count, is_favorite, is_demo, content_type,
      podcast_title, podcast_author, podcast_episode_number, podcast_season_number,
      podcast_description, podcast_published_at, loudness_adjust_db, replaygain_track_gain,
      replaygain_album_gain, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `)

  for (const [index, track] of demoData.youtubeTracks.entries()) {
    const cachedPath = track.isCached ? path.join(ytDemoDir, `${track.videoId}.wav`) : null
    if (cachedPath) writeWav(cachedPath, 196 + index * 42, 6)

    insertYTTrack.run(
      track.videoId,
      track.title,
      track.artist,
      track.album,
      track.duration,
      track.thumbnailUrl,
      track.isCached ? 1 : 0,
      cachedPath,
      track.playCount,
      track.isFavorite ? 1 : 0,
      track.contentType || "music",
      track.podcastTitle || null,
      track.podcastAuthor || null,
      track.podcastEpisodeNumber || null,
      track.podcastSeasonNumber || null,
      track.podcastDescription || null,
      track.podcastPublishedAt || null,
      0,
      null,
      null
    )

    if (track.isCached && cachedPath) {
      insertPromotedYouTubeTrack(db, track, cachedPath)
    }
  }
}

function insertPromotedYouTubeTrack(db, track, cachedPath) {
  const fileName = path.basename(cachedPath)
  const stat = fs.statSync(cachedPath)
  db.prepare(`
    INSERT OR IGNORE INTO tracks (
      title, artist, album, album_artist, genre, year, track_number, disc_number,
      duration, file_path, file_name, file_size, file_format, bit_rate, sample_rate,
      cover_art_path, mood, tempo, language, style, play_count, is_favorite, is_demo,
      content_type, podcast_title, podcast_author, podcast_episode_number, podcast_season_number,
      podcast_description, podcast_published_at, loudness_adjust_db, replaygain_track_gain,
      replaygain_album_gain, storage_kind, storage_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'youtube', ?, datetime('now'), datetime('now'))
  `).run(
    track.title,
    track.artist,
    track.album || "YouTube Downloads",
    track.artist,
    "YouTube",
    null,
    null,
    null,
    track.duration,
    `/api/youtube/stream/${track.videoId}`,
    fileName,
    stat.size,
    "WAV",
    705,
    SAMPLE_RATE,
    track.thumbnailUrl,
    "upbeat",
    120,
    "en",
    "online-video",
    track.playCount,
    track.isFavorite ? 1 : 0,
    track.contentType || "music",
    track.podcastTitle || null,
    track.podcastAuthor || null,
    track.podcastEpisodeNumber || null,
    track.podcastSeasonNumber || null,
    track.podcastDescription || null,
    track.podcastPublishedAt || null,
    0,
    null,
    null,
    cachedPath
  )
}

function seedDemoActivity(db, demoTrackIds) {
  const insertHistory = db.prepare(`
    INSERT INTO listen_history (user_id, track_id, yt_video_id, source, event_type, completed, progress_pct, device_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFeedback = db.prepare(`
    INSERT INTO track_feedback (user_id, track_id, yt_video_id, source, action)
    VALUES (?, ?, ?, ?, ?)
  `)

  for (const [index, track] of demoData.tracks.entries()) {
    const trackId = demoTrackIds.get(track.slug)
    if (!trackId || index > 5) continue
    insertHistory.run(
      null,
      trackId,
      null,
      "local",
      index % 2 === 0 ? "complete" : "skip",
      index % 2 === 0 ? 1 : 0,
      index % 2 === 0 ? 100 : 42,
      index % 3 === 0 ? "mobile" : "desktop"
    )
    if (track.isFavorite) insertFeedback.run(null, trackId, null, "local", "like")
  }

  for (const track of demoData.youtubeTracks.filter((item) => item.isFavorite)) {
    insertHistory.run(null, null, track.videoId, "youtube", "complete", 1, 100, "mobile")
    insertFeedback.run(null, null, track.videoId, "youtube", "like")
  }
}

function resetDemo(db, options = {}) {
  const demoTrackIds = db.prepare("SELECT id FROM tracks WHERE is_demo = 1").all().map((row) => row.id)
  const demoYTTrackIds = db.prepare("SELECT id FROM yt_tracks WHERE is_demo = 1").all().map((row) => row.id)
  const demoPlaylistIds = db.prepare("SELECT id FROM playlists WHERE is_demo = 1").all().map((row) => row.id)
  const demoYTPlaylistIds = db.prepare("SELECT id FROM yt_playlists WHERE is_demo = 1").all().map((row) => row.id)

  const transaction = db.transaction(() => {
    for (const id of demoPlaylistIds) {
      db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? OR is_demo = 1").run(id)
    }
    if (demoPlaylistIds.length === 0) db.prepare("DELETE FROM playlist_tracks WHERE is_demo = 1").run()

    for (const id of demoYTPlaylistIds) {
      db.prepare("DELETE FROM yt_playlist_tracks WHERE yt_playlist_id = ? OR is_demo = 1").run(id)
    }
    if (demoYTPlaylistIds.length === 0) db.prepare("DELETE FROM yt_playlist_tracks WHERE is_demo = 1").run()

    for (const id of demoTrackIds) {
      db.prepare("DELETE FROM track_feedback WHERE track_id = ?").run(id)
      db.prepare("DELETE FROM listen_history WHERE track_id = ?").run(id)
      db.prepare("DELETE FROM playlist_tracks WHERE track_id = ?").run(id)
    }

    for (const id of demoYTTrackIds) {
      db.prepare("DELETE FROM yt_playlist_tracks WHERE yt_track_id = ?").run(id)
    }

    for (const track of demoData.youtubeTracks) {
      db.prepare("DELETE FROM listen_history WHERE yt_video_id = ?").run(track.videoId)
      db.prepare("DELETE FROM track_feedback WHERE yt_video_id = ?").run(track.videoId)
    }

    db.prepare("DELETE FROM playlists WHERE is_demo = 1").run()
    db.prepare("DELETE FROM yt_playlists WHERE is_demo = 1").run()
    db.prepare("DELETE FROM tracks WHERE is_demo = 1").run()
    db.prepare("DELETE FROM yt_tracks WHERE is_demo = 1").run()
  })

  transaction()
  fs.rmSync(DEMO_DIR, { recursive: true, force: true })

  if (!options.quiet) {
    console.log(`Removed ${demoTrackIds.length} demo local tracks and ${demoYTTrackIds.length} demo YouTube tracks.`)
  }
}

function generateDemoMedia() {
  fs.mkdirSync(path.join(DEMO_DIR, "audio"), { recursive: true })
  fs.mkdirSync(path.join(DEMO_DIR, "video"), { recursive: true })

  for (const track of demoData.tracks) {
    if (track.kind === "video") {
      fs.writeFileSync(
        path.join(DEMO_DIR, "video", `${track.slug}.mp4`),
        Buffer.from(TINY_MP4_BASE64, "base64")
      )
    } else {
      writeWav(path.join(DEMO_DIR, "audio", `${track.slug}.wav`), track.frequency, track.duration)
    }
  }
}

function writeWav(filePath, frequency, durationSeconds) {
  const samples = Math.max(1, Math.floor(SAMPLE_RATE * durationSeconds))
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE
    const fadeIn = Math.min(1, i / (SAMPLE_RATE * 0.05))
    const fadeOut = Math.min(1, (samples - i) / (SAMPLE_RATE * 0.1))
    const envelope = Math.min(fadeIn, fadeOut)
    const tone = Math.sin(2 * Math.PI * frequency * t)
    const harmonic = 0.35 * Math.sin(2 * Math.PI * frequency * 2 * t)
    const sample = Math.max(-1, Math.min(1, (tone + harmonic) * 0.28 * envelope))
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
}

function printStatus(db) {
  const counts = {
    demoTracks: db.prepare("SELECT COUNT(*) as count FROM tracks WHERE is_demo = 1").get().count,
    demoYouTubeTracks: db.prepare("SELECT COUNT(*) as count FROM yt_tracks WHERE is_demo = 1").get().count,
    demoPlaylists: db.prepare("SELECT COUNT(*) as count FROM playlists WHERE is_demo = 1").get().count,
    demoPodcasts: db.prepare("SELECT COUNT(*) as count FROM tracks WHERE is_demo = 1 AND content_type = 'podcast'").get().count,
    allTracks: db.prepare("SELECT COUNT(*) as count FROM tracks").get().count,
    allYouTubeTracks: db.prepare("SELECT COUNT(*) as count FROM yt_tracks").get().count,
  }

  console.log(JSON.stringify({ dbPath: DB_PATH, demoDir: DEMO_DIR, ...counts }, null, 2))
}

async function verifyDemo(db) {
  const status = {
    demoTracks: db.prepare("SELECT COUNT(*) as count FROM tracks WHERE is_demo = 1").get().count,
    demoYouTubeTracks: db.prepare("SELECT COUNT(*) as count FROM yt_tracks WHERE is_demo = 1").get().count,
    demoPlaylists: db.prepare("SELECT COUNT(*) as count FROM playlists WHERE is_demo = 1").get().count,
    demoHistory: db.prepare(`
      SELECT COUNT(*) as count FROM listen_history lh
      LEFT JOIN tracks t ON t.id = lh.track_id
      WHERE t.is_demo = 1 OR lh.yt_video_id IN (${demoData.youtubeTracks.map(() => "?").join(",")})
    `).get(...demoData.youtubeTracks.map((track) => track.videoId)).count,
    demoPodcasts: db.prepare("SELECT COUNT(*) as count FROM tracks WHERE is_demo = 1 AND content_type = 'podcast'").get().count,
  }

  assert(status.demoTracks >= demoData.tracks.length + 1, "Demo local tracks were not seeded")
  assert(status.demoYouTubeTracks === demoData.youtubeTracks.length, "Demo YouTube tracks were not seeded")
  assert(status.demoPlaylists === demoData.playlists.length, "Demo playlists were not seeded")
  assert(status.demoHistory > 0, "Demo history was not seeded")
  assert(status.demoPodcasts > 0, "Demo podcast episode was not seeded")

  for (const track of demoData.tracks) {
    const ext = track.kind === "video" ? ".mp4" : ".wav"
    const mediaKind = track.kind === "video" ? "video" : "audio"
    const filePath = path.join(DEMO_DIR, mediaKind, `${track.slug}${ext}`)
    assert(fs.existsSync(filePath), `Missing demo media: ${filePath}`)
    assert(fs.statSync(filePath).size > 0, `Empty demo media: ${filePath}`)
  }

  const cachedTrack = demoData.youtubeTracks.find((track) => track.isCached)
  assert(cachedTrack, "Expected a cached demo YouTube track")
  const promoted = db.prepare("SELECT * FROM tracks WHERE file_path = ? AND is_demo = 1").get(`/api/youtube/stream/${cachedTrack.videoId}`)
  assert(promoted, "Cached demo YouTube track was not promoted into local library")

  const smoke = db.prepare("SELECT is_demo FROM tracks WHERE title = ?").get("Me at the zoo")
  if (smoke) assert(smoke.is_demo === 0, "Existing YouTube smoke-test track was marked as demo")

  await verifyHttpRangeIfServerIsRunning()
  console.log("Demo verification passed.")
}

async function verifyHttpRangeIfServerIsRunning() {
  const baseUrl = process.env.MELODIA_BASE_URL || "http://127.0.0.1:3000"
  const targets = [
    "/api/demo/media/audio/midnight-current.wav",
    "/api/demo/media/video/signal-window.mp4",
  ]

  try {
    for (const target of targets) {
      const response = await fetch(`${baseUrl}${target}`, {
        headers: { Range: "bytes=0-127" },
        signal: AbortSignal.timeout(1500),
      })
      assert(response.status === 206, `${target} did not return 206 Partial Content`)
    }
  } catch (error) {
    console.log(`Skipped HTTP range verification; no dev server reachable at ${baseUrl}.`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
