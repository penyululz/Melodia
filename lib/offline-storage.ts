/**
 * IndexedDB-based offline storage for media files.
 * Media is scoped to the currently logged-in account on this device.
 */

const DB_NAME = "melodia-offline"
const DB_VERSION = 2
const AUDIO_STORE = "audio-files"
const METADATA_STORE = "track-metadata"

export interface OfflineTrack {
  id: string
  trackId: string
  ownerId: string
  title: string
  artist: string
  album?: string
  duration: number
  cover_art_path?: string
  file_path: string
  source: "local" | "youtube"
  videoId?: string
  savedAt: number
  size: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Store for audio file blobs
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE, { keyPath: "id" })
      }

      // Store for track metadata
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const metaStore = db.createObjectStore(METADATA_STORE, { keyPath: "id" })
        metaStore.createIndex("savedAt", "savedAt", { unique: false })
        metaStore.createIndex("source", "source", { unique: false })
        metaStore.createIndex("ownerId", "ownerId", { unique: false })
        metaStore.createIndex("trackId", "trackId", { unique: false })
      } else {
        const metaStore = request.transaction?.objectStore(METADATA_STORE)
        if (metaStore && !metaStore.indexNames.contains("ownerId")) {
          metaStore.createIndex("ownerId", "ownerId", { unique: false })
        }
        if (metaStore && !metaStore.indexNames.contains("trackId")) {
          metaStore.createIndex("trackId", "trackId", { unique: false })
        }
      }

      if (event.oldVersion < 2) {
        request.transaction?.objectStore(AUDIO_STORE).clear()
        request.transaction?.objectStore(METADATA_STORE).clear()
      }
    }
  })

  return dbPromise
}

/**
 * Save an audio file for offline playback
 */
export async function saveForOffline(
  track: {
    id: string | number
    title: string
    artist?: string | null
    album?: string | null
    duration?: number | null
    cover_art_path?: string | null
    file_path?: string
    source?: "local" | "youtube"
    videoId?: string
  },
  audioBlob: Blob
): Promise<void> {
  const ownerId = getCurrentOfflineOwnerId()
  if (!ownerId) {
    throw new Error("Sign in to save tracks for offline playback")
  }

  const db = await openDB()
  const trackId = String(track.id)
  const offlineId = getOfflineRecordId(trackId, ownerId)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([AUDIO_STORE, METADATA_STORE], "readwrite")

    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    // Save audio blob
    const audioStore = transaction.objectStore(AUDIO_STORE)
    audioStore.put({ id: offlineId, trackId, ownerId, blob: audioBlob })

    // Save metadata
    const metaStore = transaction.objectStore(METADATA_STORE)
    const offlineTrack: OfflineTrack = {
      id: offlineId,
      trackId,
      ownerId,
      title: track.title,
      artist: track.artist || "Unknown Artist",
      album: track.album || undefined,
      duration: track.duration || 0,
      cover_art_path: track.cover_art_path || undefined,
      file_path: track.file_path || "",
      source: track.source || "local",
      videoId: track.videoId,
      savedAt: Date.now(),
      size: audioBlob.size,
    }
    metaStore.put(offlineTrack)
  })
}

/**
 * Get audio blob for offline playback
 */
export async function getOfflineAudio(trackId: string): Promise<Blob | null> {
  const ownerId = getCurrentOfflineOwnerId()
  if (!ownerId) return null

  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE, "readonly")
    const store = transaction.objectStore(AUDIO_STORE)
    const request = store.get(getOfflineRecordId(trackId, ownerId))

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      resolve(request.result?.blob || null)
    }
  })
}

/**
 * Check if a track is available offline
 */
export async function isAvailableOffline(trackId: string): Promise<boolean> {
  const ownerId = getCurrentOfflineOwnerId()
  if (!ownerId) return false

  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE, "readonly")
    const store = transaction.objectStore(METADATA_STORE)
    const request = store.get(getOfflineRecordId(trackId, ownerId))

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      resolve(!!request.result)
    }
  })
}

/**
 * Get all offline tracks
 */
export async function getAllOfflineTracks(): Promise<OfflineTrack[]> {
  const ownerId = getCurrentOfflineOwnerId()
  if (!ownerId) return []

  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE, "readonly")
    const store = transaction.objectStore(METADATA_STORE)
    const request = store.index("ownerId").getAll(ownerId)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      resolve(request.result || [])
    }
  })
}

/**
 * Remove a track from offline storage
 */
export async function removeFromOffline(trackId: string): Promise<void> {
  const ownerId = getCurrentOfflineOwnerId()
  if (!ownerId) return

  const db = await openDB()
  const offlineId = getOfflineRecordId(trackId, ownerId)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([AUDIO_STORE, METADATA_STORE], "readwrite")

    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    transaction.objectStore(AUDIO_STORE).delete(offlineId)
    transaction.objectStore(METADATA_STORE).delete(offlineId)
  })
}

/**
 * Get total offline storage used
 */
export async function getOfflineStorageUsed(): Promise<number> {
  const tracks = await getAllOfflineTracks()
  return tracks.reduce((total, track) => total + track.size, 0)
}

/**
 * Clear all offline data
 */
export async function clearOfflineStorage(): Promise<void> {
  const ownerId = getCurrentOfflineOwnerId()
  if (!ownerId) return

  const db = await openDB()
  const tracks = await getAllOfflineTracks()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([AUDIO_STORE, METADATA_STORE], "readwrite")

    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()

    const audioStore = transaction.objectStore(AUDIO_STORE)
    const metaStore = transaction.objectStore(METADATA_STORE)

    for (const track of tracks) {
      if (track.ownerId === ownerId) {
        audioStore.delete(track.id)
        metaStore.delete(track.id)
      }
    }
  })
}

/**
 * Create an object URL for offline audio playback
 */
export async function getOfflineAudioUrl(trackId: string): Promise<string | null> {
  const blob = await getOfflineAudio(trackId)
  if (!blob) return null
  return URL.createObjectURL(blob)
}

export function getOfflineRecordId(trackId: string, ownerId: string): string {
  return `${ownerId}:${trackId}`
}

export function getCurrentOfflineOwnerId(): string | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem("melodia-auth")
    const user = raw ? JSON.parse(raw)?.state?.user : null
    const id = user?.id
    return id === undefined || id === null ? null : `user:${id}`
  } catch {
    return null
  }
}
