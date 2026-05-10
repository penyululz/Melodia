import "server-only"
import Database from "better-sqlite3"
import path from "path"
import fs from "fs"
import os from "os"

// In-memory fallback for development/preview environments
let db: any

try {
  // Try to initialize real SQLite database
  const dbPath = getDatabasePath()
  db = new Database(dbPath)

  // Enable WAL mode for better concurrent performance
  db.pragma("journal_mode = WAL")
  db.pragma("busy_timeout = 5000")
} catch (error) {
  console.warn("[v0] SQLite initialization failed, using in-memory fallback:", error)
  // Fallback for preview environments
  db = {
    pragma: () => {},
    exec: () => {},
    prepare: () => ({
      all: () => [],
      get: () => null,
      run: () => {},
    }),
    transaction: (fn: () => void) => fn,
  }
}

function getDatabasePath(): string {
  if (isBuildPhase()) {
    const buildDir = path.join(os.tmpdir(), "melodia-build-db")
    fs.mkdirSync(buildDir, { recursive: true })
    return path.join(buildDir, `music-${process.pid}.db`)
  }

  const dataDir = path.join(process.cwd(), "data")
  fs.mkdirSync(dataDir, { recursive: true })
  return path.join(dataDir, "music.db")
}

function isBuildPhase(): boolean {
  return (
    process.env.MELODIA_BUILD_DB === "1" ||
    process.env.NEXT_PHASE === "phase-production-build"
  )
}

// Initialize database schema
db.exec(`
  -- Tracks table
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
    playback_path TEXT,
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

  -- Playlists table
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

  -- Playlist tracks (join table)
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

  CREATE TABLE IF NOT EXISTS playlist_youtube_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    yt_track_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    is_demo INTEGER DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(playlist_id, yt_track_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (yt_track_id) REFERENCES yt_tracks(id) ON DELETE CASCADE
  );

  -- Users and sessions
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  );

  -- Listening history and feedback
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
    listened_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS track_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    track_id INTEGER,
    yt_video_id TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    action TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
  );

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

  CREATE TABLE IF NOT EXISTS api_cache (
    cache_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_quota_usage (
    provider TEXT NOT NULL,
    quota_date TEXT NOT NULL,
    units INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (provider, quota_date)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
  CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
  CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
  CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
  CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_tracks_mood ON tracks(mood);
  CREATE INDEX IF NOT EXISTS idx_tracks_style ON tracks(style);
  CREATE INDEX IF NOT EXISTS idx_tracks_language ON tracks(language);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_youtube_tracks_playlist ON playlist_youtube_tracks(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_youtube_tracks_track ON playlist_youtube_tracks(yt_track_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_listen_history_user ON listen_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_listen_history_track ON listen_history(track_id);
  CREATE INDEX IF NOT EXISTS idx_listen_history_yt_video ON listen_history(yt_video_id);
  CREATE INDEX IF NOT EXISTS idx_track_feedback_user ON track_feedback(user_id);
  CREATE INDEX IF NOT EXISTS idx_track_feedback_track ON track_feedback(track_id);
  CREATE INDEX IF NOT EXISTS idx_track_feedback_yt_video ON track_feedback(yt_video_id);
  CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query);
  CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);

  -- YouTube Music tracks
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
    cached_quality TEXT,
    cached_media_type TEXT,
    play_count INTEGER DEFAULT 0,
    last_played_at TEXT,
    is_favorite INTEGER DEFAULT 0,
    is_demo INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- YouTube Music imported playlists
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

  -- YouTube playlist tracks (join table)
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

  -- Indexes for YouTube tables
  CREATE INDEX IF NOT EXISTS idx_yt_tracks_video_id ON yt_tracks(video_id);
  CREATE INDEX IF NOT EXISTS idx_yt_tracks_cached ON yt_tracks(is_cached);
  CREATE INDEX IF NOT EXISTS idx_yt_tracks_favorite ON yt_tracks(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_yt_tracks_content_type ON yt_tracks(content_type);
  CREATE INDEX IF NOT EXISTS idx_yt_playlists_playlist_id ON yt_playlists(playlist_id);
`)

ensureColumn("tracks", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("tracks", "storage_kind", "TEXT DEFAULT 'unknown'")
ensureColumn("tracks", "storage_path", "TEXT")
ensureColumn("tracks", "playback_path", "TEXT")
ensureColumn("tracks", "lyrics_plain", "TEXT")
ensureColumn("tracks", "lyrics_synced", "TEXT")
ensureColumn("tracks", "lyrics_source", "TEXT")
ensureColumn("tracks", "mood", "TEXT")
ensureColumn("tracks", "tempo", "INTEGER")
ensureColumn("tracks", "language", "TEXT")
ensureColumn("tracks", "style", "TEXT")
ensureColumn("tracks", "content_type", "TEXT DEFAULT 'music'")
ensureColumn("tracks", "podcast_title", "TEXT")
ensureColumn("tracks", "podcast_author", "TEXT")
ensureColumn("tracks", "podcast_episode_number", "INTEGER")
ensureColumn("tracks", "podcast_season_number", "INTEGER")
ensureColumn("tracks", "podcast_description", "TEXT")
ensureColumn("tracks", "podcast_published_at", "TEXT")
ensureColumn("tracks", "loudness_adjust_db", "REAL DEFAULT 0")
ensureColumn("tracks", "replaygain_track_gain", "REAL")
ensureColumn("tracks", "replaygain_album_gain", "REAL")
ensureColumn("playlists", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("playlist_tracks", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("playlist_youtube_tracks", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("yt_tracks", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("yt_tracks", "cached_quality", "TEXT")
ensureColumn("yt_tracks", "cached_media_type", "TEXT")
ensureColumn("yt_tracks", "content_type", "TEXT DEFAULT 'music'")
ensureColumn("yt_tracks", "podcast_title", "TEXT")
ensureColumn("yt_tracks", "podcast_author", "TEXT")
ensureColumn("yt_tracks", "podcast_episode_number", "INTEGER")
ensureColumn("yt_tracks", "podcast_season_number", "INTEGER")
ensureColumn("yt_tracks", "podcast_description", "TEXT")
ensureColumn("yt_tracks", "podcast_published_at", "TEXT")
ensureColumn("yt_tracks", "loudness_adjust_db", "REAL DEFAULT 0")
ensureColumn("yt_tracks", "replaygain_track_gain", "REAL")
ensureColumn("yt_tracks", "replaygain_album_gain", "REAL")
ensureColumn("yt_playlists", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("yt_playlist_tracks", "is_demo", "INTEGER DEFAULT 0")
ensureColumn("listen_history", "device_type", "TEXT")
ensureColumn("listen_history", "event_type", "TEXT DEFAULT 'play'")

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tracks_demo ON tracks(is_demo);
  CREATE INDEX IF NOT EXISTS idx_tracks_storage_kind ON tracks(storage_kind);
  CREATE INDEX IF NOT EXISTS idx_yt_tracks_demo ON yt_tracks(is_demo);
  CREATE INDEX IF NOT EXISTS idx_yt_playlists_demo ON yt_playlists(is_demo);
`)

runMigrations()

function ensureColumn(table: string, column: string, definition: string) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!columns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  } catch (error) {
    console.warn(`[v0] Could not ensure ${table}.${column}:`, error)
  }
}

function runMigrations() {
  const migrations = [
    {
      id: 1,
      name: "add_demo_flags",
      run: () => {
        ensureColumn("tracks", "is_demo", "INTEGER DEFAULT 0")
        ensureColumn("playlists", "is_demo", "INTEGER DEFAULT 0")
        ensureColumn("playlist_tracks", "is_demo", "INTEGER DEFAULT 0")
        ensureColumn("yt_tracks", "is_demo", "INTEGER DEFAULT 0")
        ensureColumn("yt_playlists", "is_demo", "INTEGER DEFAULT 0")
        ensureColumn("yt_playlist_tracks", "is_demo", "INTEGER DEFAULT 0")
      },
    },
    {
      id: 2,
      name: "add_track_storage_metadata",
      run: () => {
        ensureColumn("tracks", "storage_kind", "TEXT DEFAULT 'unknown'")
        ensureColumn("tracks", "storage_path", "TEXT")
      },
    },
    {
      id: 3,
      name: "add_youtube_cache_quality_metadata",
      run: () => {
        ensureColumn("yt_tracks", "cached_quality", "TEXT")
        ensureColumn("yt_tracks", "cached_media_type", "TEXT")
      },
    },
    {
      id: 4,
      name: "add_track_playback_path",
      run: () => {
        ensureColumn("tracks", "playback_path", "TEXT")
      },
    },
    {
      id: 5,
      name: "add_search_history_and_device_context",
      run: () => {
        ensureColumn("listen_history", "device_type", "TEXT")
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
      },
    },
    {
      id: 6,
      name: "add_recommendation_descriptors_and_api_cache",
      run: () => {
        ensureColumn("tracks", "mood", "TEXT")
        ensureColumn("tracks", "tempo", "INTEGER")
        ensureColumn("tracks", "language", "TEXT")
        ensureColumn("tracks", "style", "TEXT")
        ensureColumn("listen_history", "event_type", "TEXT DEFAULT 'play'")
        db.exec(`
          CREATE TABLE IF NOT EXISTS api_cache (
            cache_key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS api_quota_usage (
            provider TEXT NOT NULL,
            quota_date TEXT NOT NULL,
            units INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (provider, quota_date)
          );

          CREATE INDEX IF NOT EXISTS idx_tracks_mood ON tracks(mood);
          CREATE INDEX IF NOT EXISTS idx_tracks_style ON tracks(style);
  CREATE INDEX IF NOT EXISTS idx_tracks_language ON tracks(language);
  CREATE INDEX IF NOT EXISTS idx_tracks_content_type ON tracks(content_type);
  CREATE INDEX IF NOT EXISTS idx_yt_tracks_content_type ON yt_tracks(content_type);
  CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
        `)
      },
    },
    {
      id: 7,
      name: "add_local_lyrics_cache",
      run: () => {
        ensureColumn("tracks", "lyrics_plain", "TEXT")
        ensureColumn("tracks", "lyrics_synced", "TEXT")
        ensureColumn("tracks", "lyrics_source", "TEXT")
      },
    },
    {
      id: 8,
      name: "add_podcast_and_loudness_metadata",
      run: () => {
        ensureColumn("tracks", "content_type", "TEXT DEFAULT 'music'")
        ensureColumn("tracks", "podcast_title", "TEXT")
        ensureColumn("tracks", "podcast_author", "TEXT")
        ensureColumn("tracks", "podcast_episode_number", "INTEGER")
        ensureColumn("tracks", "podcast_season_number", "INTEGER")
        ensureColumn("tracks", "podcast_description", "TEXT")
        ensureColumn("tracks", "podcast_published_at", "TEXT")
        ensureColumn("tracks", "loudness_adjust_db", "REAL DEFAULT 0")
        ensureColumn("tracks", "replaygain_track_gain", "REAL")
        ensureColumn("tracks", "replaygain_album_gain", "REAL")
        ensureColumn("yt_tracks", "content_type", "TEXT DEFAULT 'music'")
        ensureColumn("yt_tracks", "podcast_title", "TEXT")
        ensureColumn("yt_tracks", "podcast_author", "TEXT")
        ensureColumn("yt_tracks", "podcast_episode_number", "INTEGER")
        ensureColumn("yt_tracks", "podcast_season_number", "INTEGER")
        ensureColumn("yt_tracks", "podcast_description", "TEXT")
        ensureColumn("yt_tracks", "podcast_published_at", "TEXT")
        ensureColumn("yt_tracks", "loudness_adjust_db", "REAL DEFAULT 0")
        ensureColumn("yt_tracks", "replaygain_track_gain", "REAL")
        ensureColumn("yt_tracks", "replaygain_album_gain", "REAL")
        db.exec(`
          UPDATE tracks SET content_type = 'music' WHERE content_type IS NULL OR content_type = '';
          UPDATE yt_tracks SET content_type = 'music' WHERE content_type IS NULL OR content_type = '';
          CREATE INDEX IF NOT EXISTS idx_tracks_content_type ON tracks(content_type);
          CREATE INDEX IF NOT EXISTS idx_yt_tracks_content_type ON yt_tracks(content_type);
        `)
      },
    },
    {
      id: 9,
      name: "add_user_playlist_youtube_tracks",
      run: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS playlist_youtube_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            yt_track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            is_demo INTEGER DEFAULT 0,
            added_at TEXT DEFAULT (datetime('now')),
            UNIQUE(playlist_id, yt_track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (yt_track_id) REFERENCES yt_tracks(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_playlist_youtube_tracks_playlist ON playlist_youtube_tracks(playlist_id);
          CREATE INDEX IF NOT EXISTS idx_playlist_youtube_tracks_track ON playlist_youtube_tracks(yt_track_id);
        `)
        ensureColumn("playlist_youtube_tracks", "is_demo", "INTEGER DEFAULT 0")
      },
    },
  ]

  for (const migration of migrations) {
    const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(migration.id)
    if (applied) continue

    const apply = db.transaction(() => {
      migration.run()
      db.prepare("INSERT OR IGNORE INTO schema_migrations (id, name) VALUES (?, ?)").run(
        migration.id,
        migration.name
      )
    })

    apply()
  }
}

export default db

// Type definitions
export interface User {
  id: number
  email: string
  password_hash: string
  name: string
  avatar_url: string | null
  role: string
  is_active: number
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  user_id: number
  expires_at: string
  created_at: string
}

export interface Track {
  id: number
  title: string
  artist: string | null
  album: string | null
  album_artist: string | null
  genre: string | null
  year: number | null
  track_number: number | null
  disc_number: number | null
  duration: number | null
  file_path: string
  file_name: string
  storage_kind: string | null
  storage_path: string | null
  playback_path: string | null
  file_size: number | null
  file_format: string | null
  bit_rate: number | null
  sample_rate: number | null
  cover_art_path: string | null
  lyrics_plain: string | null
  lyrics_synced: string | null
  lyrics_source: string | null
  mood: string | null
  tempo: number | null
  language: string | null
  style: string | null
  content_type: string | null
  podcast_title: string | null
  podcast_author: string | null
  podcast_episode_number: number | null
  podcast_season_number: number | null
  podcast_description: string | null
  podcast_published_at: string | null
  loudness_adjust_db: number | null
  replaygain_track_gain: number | null
  replaygain_album_gain: number | null
  play_count: number
  last_played_at: string | null
  is_favorite: number
  is_demo: number
  created_at: string
  updated_at: string
}

export interface Playlist {
  id: number
  name: string
  description: string | null
  cover_image_path: string | null
  is_smart: number
  smart_rules: string | null
  is_demo: number
  created_at: string
  updated_at: string
}

export interface PlaylistTrack {
  id: number
  playlist_id: number
  track_id: number
  position: number
  is_demo: number
  added_at: string
}

export interface PlaylistYouTubeTrack {
  id: number
  playlist_id: number
  yt_track_id: number
  position: number
  is_demo: number
  added_at: string
}

export interface YTTrack {
  id: number
  video_id: string
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  thumbnail_url: string | null
  content_type: string | null
  podcast_title: string | null
  podcast_author: string | null
  podcast_episode_number: number | null
  podcast_season_number: number | null
  podcast_description: string | null
  podcast_published_at: string | null
  loudness_adjust_db: number | null
  replaygain_track_gain: number | null
  replaygain_album_gain: number | null
  is_cached: number
  cached_file_path: string | null
  cached_quality: string | null
  cached_media_type: string | null
  play_count: number
  last_played_at: string | null
  is_favorite: number
  is_demo: number
  created_at: string
  updated_at: string
}

export interface YTPlaylist {
  id: number
  playlist_id: string
  name: string
  description: string | null
  thumbnail_url: string | null
  track_count: number
  last_synced_at: string
  is_demo: number
  created_at: string
}

// Query helpers
export const queries = {
  // Tracks
  getAllTracks: db.prepare(`
    SELECT * FROM tracks ORDER BY artist, album, track_number
  `),

  getTrackById: db.prepare(`
    SELECT * FROM tracks WHERE id = ?
  `),

  getTracksByArtist: db.prepare(`
    SELECT * FROM tracks WHERE artist = ? ORDER BY album, track_number
  `),

  getTracksByAlbum: db.prepare(`
    SELECT * FROM tracks WHERE album = ? ORDER BY disc_number, track_number
  `),

  getTracksByGenre: db.prepare(`
    SELECT * FROM tracks WHERE genre = ? ORDER BY artist, album, track_number
  `),

  getFavoriteTracks: db.prepare(`
    SELECT * FROM tracks WHERE is_favorite = 1 ORDER BY title
  `),

  getRecentTracks: db.prepare(`
    SELECT * FROM tracks ORDER BY created_at DESC LIMIT 50
  `),

  getMostPlayedTracks: db.prepare(`
    SELECT * FROM tracks WHERE play_count > 0 ORDER BY play_count DESC LIMIT 50
  `),

  searchTracks: db.prepare(`
    SELECT * FROM tracks 
    WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ? OR mood LIKE ? OR style LIKE ? OR language LIKE ?
      OR podcast_title LIKE ? OR podcast_author LIKE ? OR podcast_description LIKE ?
    ORDER BY title LIMIT 100
  `),

  insertTrack: db.prepare(`
    INSERT INTO tracks (
      title, artist, album, album_artist, genre, year, 
      track_number, disc_number, duration, file_path, file_name,
      file_size, file_format, bit_rate, sample_rate, cover_art_path,
      mood, tempo, language, style, content_type,
      podcast_title, podcast_author, podcast_episode_number, podcast_season_number,
      podcast_description, podcast_published_at, loudness_adjust_db, replaygain_track_gain,
      replaygain_album_gain
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateTrack: db.prepare(`
    UPDATE tracks SET
      title = ?, artist = ?, album = ?, genre = ?, year = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `),

  toggleFavorite: db.prepare(`
    UPDATE tracks SET is_favorite = NOT is_favorite, updated_at = datetime('now')
    WHERE id = ?
  `),

  incrementPlayCount: db.prepare(`
    UPDATE tracks SET 
      play_count = play_count + 1, 
      last_played_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `),

  deleteTrack: db.prepare(`DELETE FROM tracks WHERE id = ?`),

  // Albums (aggregated from tracks)
  getAlbums: db.prepare(`
    SELECT 
      album, 
      COALESCE(album_artist, artist) as artist,
      year,
      MAX(cover_art_path) as cover_art_path,
      COUNT(*) as track_count
    FROM tracks 
    WHERE album IS NOT NULL AND album != '' AND COALESCE(content_type, 'music') != 'podcast'
    GROUP BY album, COALESCE(album_artist, artist)
    ORDER BY artist, album
  `),

  // Artists (aggregated from tracks)
  getArtists: db.prepare(`
    SELECT 
      artist,
      COUNT(*) as track_count,
      COUNT(DISTINCT album) as album_count
    FROM tracks 
    WHERE artist IS NOT NULL AND artist != '' AND COALESCE(content_type, 'music') != 'podcast'
    GROUP BY artist
    ORDER BY artist
  `),

  // Genres (aggregated from tracks)
  getGenres: db.prepare(`
    SELECT 
      genre,
      COUNT(*) as track_count
    FROM tracks 
    WHERE genre IS NOT NULL AND genre != '' AND COALESCE(content_type, 'music') != 'podcast'
    GROUP BY genre
    ORDER BY genre
  `),

  // Playlists
  getAllPlaylists: db.prepare(`
    SELECT * FROM playlists ORDER BY name
  `),

  getPlaylistById: db.prepare(`
    SELECT * FROM playlists WHERE id = ?
  `),

  getPlaylistTracks: db.prepare(`
    SELECT t.* FROM tracks t
    JOIN playlist_tracks pt ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `),

  createPlaylist: db.prepare(`
    INSERT INTO playlists (name, description, is_smart, smart_rules)
    VALUES (?, ?, ?, ?)
  `),

  addToPlaylist: db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?))
  `),

  removeFromPlaylist: db.prepare(`
    DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
  `),

  deletePlaylist: db.prepare(`DELETE FROM playlists WHERE id = ?`),

  // Stats
  getLibraryStats: db.prepare(`
    SELECT 
      COUNT(*) as total_tracks,
      COALESCE(SUM(duration), 0) as total_duration,
      COUNT(DISTINCT artist) as total_artists,
      COUNT(DISTINCT album) as total_albums
    FROM tracks
  `),

  // YouTube Music queries
  getYTTrackByVideoId: db.prepare(`
    SELECT * FROM yt_tracks WHERE video_id = ?
  `),

  getAllYTTracks: db.prepare(`
    SELECT * FROM yt_tracks ORDER BY created_at DESC
  `),

  getCachedYTTracks: db.prepare(`
    SELECT * FROM yt_tracks WHERE is_cached = 1 ORDER BY title
  `),

  getFavoriteYTTracks: db.prepare(`
    SELECT * FROM yt_tracks WHERE is_favorite = 1 ORDER BY title
  `),

  getYTTracksForCaching: db.prepare(`
    SELECT * FROM yt_tracks WHERE is_cached = 0 AND play_count >= 3 ORDER BY play_count DESC
  `),

  insertYTTrack: db.prepare(`
    INSERT OR IGNORE INTO yt_tracks (video_id, title, artist, album, duration, thumbnail_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  updateYTTrackCached: db.prepare(`
    UPDATE yt_tracks SET
      is_cached = 1,
      cached_file_path = ?,
      cached_quality = ?,
      cached_media_type = ?,
      updated_at = datetime('now')
    WHERE video_id = ?
  `),

  incrementYTPlayCount: db.prepare(`
    UPDATE yt_tracks SET 
      play_count = play_count + 1, 
      last_played_at = datetime('now'),
      updated_at = datetime('now')
    WHERE video_id = ?
  `),

  toggleYTFavorite: db.prepare(`
    UPDATE yt_tracks SET is_favorite = NOT is_favorite, updated_at = datetime('now')
    WHERE video_id = ?
  `),

  // YouTube Playlists
  getAllYTPlaylists: db.prepare(`
    SELECT * FROM yt_playlists ORDER BY name
  `),

  getYTPlaylistById: db.prepare(`
    SELECT * FROM yt_playlists WHERE id = ?
  `),

  getYTPlaylistByPlaylistId: db.prepare(`
    SELECT * FROM yt_playlists WHERE playlist_id = ?
  `),

  getYTPlaylistTracks: db.prepare(`
    SELECT t.* FROM yt_tracks t
    JOIN yt_playlist_tracks pt ON t.id = pt.yt_track_id
    WHERE pt.yt_playlist_id = ?
    ORDER BY pt.position
  `),

  insertYTPlaylist: db.prepare(`
    INSERT OR REPLACE INTO yt_playlists (playlist_id, name, description, thumbnail_url, track_count, last_synced_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `),

  addToYTPlaylist: db.prepare(`
    INSERT OR IGNORE INTO yt_playlist_tracks (yt_playlist_id, yt_track_id, position)
    VALUES (?, ?, ?)
  `),

  deleteYTPlaylist: db.prepare(`DELETE FROM yt_playlists WHERE id = ?`),

  // Combined stats
  getFullLibraryStats: db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM tracks) as local_tracks,
      (SELECT COUNT(*) FROM yt_tracks) as yt_tracks,
      (SELECT COUNT(*) FROM yt_tracks WHERE is_cached = 1) as cached_yt_tracks
  `),

  // Listen history
  insertListenHistory: db.prepare(`
    INSERT INTO listen_history (user_id, track_id, yt_video_id, source, event_type, completed, progress_pct, device_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getRecentListenHistory: db.prepare(`
    SELECT track_id, yt_video_id, source, listened_at
    FROM listen_history
    WHERE (user_id IS ? OR ? IS NULL)
    ORDER BY listened_at DESC
    LIMIT ?
  `),

  getTopGenresFromHistory: db.prepare(`
    SELECT t.genre, COUNT(*) as listen_count
    FROM listen_history lh
    JOIN tracks t ON lh.track_id = t.id
    WHERE (lh.user_id IS ? OR ? IS NULL) AND t.genre IS NOT NULL
    GROUP BY t.genre
    ORDER BY listen_count DESC
    LIMIT 5
  `),

  getTopArtistsFromHistory: db.prepare(`
    SELECT t.artist, COUNT(*) as listen_count
    FROM listen_history lh
    JOIN tracks t ON lh.track_id = t.id
    WHERE (lh.user_id IS ? OR ? IS NULL) AND t.artist IS NOT NULL
    GROUP BY t.artist
    ORDER BY listen_count DESC
    LIMIT 10
  `),

  clearListenHistory: db.prepare(`DELETE FROM listen_history WHERE user_id = ?`),

  // Track feedback (likes, dislikes, skips)
  upsertFeedback: db.prepare(`
    INSERT OR REPLACE INTO track_feedback (user_id, track_id, yt_video_id, source, action)
    VALUES (?, ?, ?, ?, ?)
  `),

  removeFeedback: db.prepare(`
    DELETE FROM track_feedback
    WHERE user_id IS ? AND (track_id IS ? OR yt_video_id IS ?) AND action = ?
  `),

  getUserFeedback: db.prepare(`
    SELECT track_id, yt_video_id, action FROM track_feedback
    WHERE (user_id IS ? OR ? IS NULL) AND action = ?
  `),

  // User management (admin)
  getUserByEmail: db.prepare(`
    SELECT * FROM users WHERE email = ?
  `),

  getUserById: db.prepare(`
    SELECT * FROM users WHERE id = ?
  `),

  createUser: db.prepare(`
    INSERT INTO users (email, password_hash, name, avatar_url, role)
    VALUES (?, ?, ?, ?, ?)
  `),

  updateUser: db.prepare(`
    UPDATE users SET name = ?, avatar_url = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  updateUserPassword: db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),

  createSession: db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
  `),

  getSessionById: db.prepare(`
    SELECT s.*, u.name as user_name, u.email as user_email, u.role as user_role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `),

  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),

  deleteExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),

  deleteUserSessions: db.prepare(`DELETE FROM sessions WHERE user_id = ?`),

  getAllUsers: db.prepare(`
    SELECT * FROM users ORDER BY created_at DESC
  `),
}
