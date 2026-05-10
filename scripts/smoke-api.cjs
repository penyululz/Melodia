#!/usr/bin/env node

const fs = require("fs")
const path = require("path")

const ROOT_DIR = path.resolve(__dirname, "..")
const BASE_URL = process.env.MELODIA_BASE_URL || "http://127.0.0.1:3000"

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

async function main() {
  if (!(await isServerReachable())) {
    console.log(`Skipped API smoke tests; no server reachable at ${BASE_URL}.`)
    return
  }

  await assertScanRejectsUnsafePath()
  await assertPlaylistMutationWorks()
  await assertUploadMutationWorks()
  await assertDownloadGetIsReadOnly()
  await assertStreamDoesNotIncrementPlayCount()
  await assertDemoMediaRanges()

  console.log("API smoke tests passed.")
}

async function isServerReachable() {
  try {
    const response = await fetch(`${BASE_URL}/api/stats`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function assertScanRejectsUnsafePath() {
  const response = await fetch(`${BASE_URL}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory: "C:\\Windows" }),
  })

  assert(response.status === 400 || response.status === 401, "Unsafe scan path was not rejected")
}

async function assertPlaylistMutationWorks() {
  const created = await postJson("/api/playlists", {
    name: `Smoke Playlist ${Date.now()}`,
    description: "Temporary smoke-test playlist",
  })

  assert(created.id, "Playlist create did not return an id")

  const deleted = await fetch(`${BASE_URL}/api/playlists/${created.id}`, { method: "DELETE" })
  assert(deleted.ok, "Playlist delete failed")
}

async function assertUploadMutationWorks() {
  const filePath = path.join(ROOT_DIR, "data", "demo", "audio", "midnight-current.wav")
  if (!fs.existsSync(filePath)) {
    console.log("Skipped upload smoke test; demo audio has not been seeded.")
    return
  }

  const bytes = fs.readFileSync(filePath)
  const formData = new FormData()
  formData.append("files", new Blob([bytes], { type: "audio/wav" }), "smoke-upload.wav")

  const response = await fetch(`${BASE_URL}/api/tracks`, {
    method: "POST",
    body: formData,
  })
  const payload = await response.json()
  assert(response.ok, `Upload smoke failed: ${JSON.stringify(payload)}`)

  const track = payload.results?.success?.[0]
  assert(track?.id, "Upload smoke did not return a track id")

  const deleted = await fetch(`${BASE_URL}/api/tracks/${track.id}`, { method: "DELETE" })
  assert(deleted.ok, "Uploaded smoke track cleanup failed")
}

async function assertDownloadGetIsReadOnly() {
  const response = await fetch(`${BASE_URL}/api/youtube/download/dQw4w9WgXcQ`)
  assert(response.status === 200 || response.status === 404, "Download status GET failed unexpectedly")
  if (response.ok) {
    const payload = await response.json()
    assert(String(payload.method || "").startsWith("POST "), "Download GET does not advertise POST")
  }
}

async function assertStreamDoesNotIncrementPlayCount() {
  const before = await getJson("/api/youtube/tracks/dQw4w9WgXcQ").catch(() => null)
  if (!before?.track) {
    console.log("Skipped YouTube stream count smoke test; demo YouTube track has not been seeded.")
    return
  }

  await fetch(`${BASE_URL}/api/youtube/stream/dQw4w9WgXcQ`, {
    headers: { Range: "bytes=0-127" },
  })
  const after = await getJson("/api/youtube/tracks/dQw4w9WgXcQ")
  assert(
    after.track.play_count === before.track.play_count,
    "YouTube stream GET incremented play count"
  )
}

async function assertDemoMediaRanges() {
  const targets = [
    "/api/demo/media/audio/midnight-current.wav",
    "/api/demo/media/video/signal-window.mp4",
  ]

  for (const target of targets) {
    const response = await fetch(`${BASE_URL}${target}`, {
      headers: { Range: "bytes=0-127" },
    })
    assert(response.status === 206, `${target} did not return partial content`)
  }
}

async function getJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`)
  assert(response.ok, `${pathname} returned ${response.status}`)
  return response.json()
}

async function postJson(pathname, body) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  assert(response.ok, `${pathname} returned ${response.status}: ${JSON.stringify(payload)}`)
  return payload
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
