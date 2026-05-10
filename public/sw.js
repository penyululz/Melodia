const APP_CACHE_NAME = "melodia-app-v9"
const NETWORK_TIMEOUT_MS = 3500

const APP_SHELL_URLS = [
  "/",
  "/library",
  "/albums",
  "/artists",
  "/favorites",
  "/genres",
  "/playlists",
  "/profile",
  "/settings",
  "/upload",
  "/youtube",
  "/offline",
  "/login",
  "/register",
  "/manifest.json",
  "/icon.svg",
  "/apple-icon.png",
  "/icon-light-32x32.png",
  "/icon-dark-32x32.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" }))
        )
      )
    )
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== APP_CACHE_NAME) {
            return caches.delete(cacheName)
          }
          return undefined
        })
      )
    )
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const request = event.request

  if (request.method !== "GET") return
  if (!request.url.startsWith(self.location.origin)) return

  const url = new URL(request.url)
  if (isDevelopmentRuntimeRequest(url)) return

  if (isMediaRequest(url)) {
    return
  }

  if (isReadableApiRequest(url)) {
    event.respondWith(networkFirst(request, APP_CACHE_NAME))
    return
  }

  if (isNextStaticRequest(url) || isStaticAssetRequest(url)) {
    event.respondWith(cacheFirst(request, APP_CACHE_NAME))
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, APP_CACHE_NAME, "/offline"))
    return
  }

  if (url.pathname.startsWith("/api/")) return

  event.respondWith(networkFirst(request, APP_CACHE_NAME))
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

function isDevelopmentRuntimeRequest(url) {
  return (
    url.pathname.includes("__turbopack") ||
    url.pathname.includes("__webpack") ||
    url.pathname.includes(".hot-update.") ||
    url.pathname.includes("/_next/webpack-hmr")
  )
}

function isNextStaticRequest(url) {
  return url.pathname.startsWith("/_next/static/")
}

function isStaticAssetRequest(url) {
  return /\.(?:css|js|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname)
}

function isMediaRequest(url) {
  return (
    url.pathname.startsWith("/api/youtube/stream/") ||
    url.pathname.startsWith("/api/media/tracks/") ||
    url.pathname.startsWith("/music/") ||
    /\.(?:aac|flac|m4a|mp3|mp4|ogg|opus|wav|webm)$/i.test(url.pathname)
  )
}

function isReadableApiRequest(url) {
  if (!url.pathname.startsWith("/api/")) return false

  return (
    url.pathname === "/api/auth/session" ||
    url.pathname === "/api/tracks" ||
    url.pathname === "/api/youtube/tracks" ||
    url.pathname === "/api/youtube/playlists" ||
    url.pathname === "/api/home" ||
    url.pathname === "/api/albums" ||
    url.pathname === "/api/artists" ||
    url.pathname === "/api/genres" ||
    url.pathname === "/api/playlists" ||
    url.pathname === "/api/stats" ||
    url.pathname === "/api/mixes" ||
    url.pathname === "/api/recommendations" ||
    url.pathname === "/api/search" ||
    url.pathname === "/api/youtube/search" ||
    url.pathname === "/api/lyrics" ||
    url.pathname.startsWith("/api/playlists/") ||
    url.pathname.startsWith("/api/youtube/playlists/")
  )
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    cache.put(request, response.clone())
  }
  return response
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached

    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl)
      if (fallback) return fallback
    }

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    })
  }
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(request, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
