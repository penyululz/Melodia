const APP_CACHE_NAME = "melodia-app-v8"
const IS_LOCAL_DEV = ["localhost", "127.0.0.1", "::1"].includes(self.location.hostname)

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
  "/manifest.json",
  "/icon.svg",
  "/apple-icon.png",
  "/icon-light-32x32.png",
  "/icon-dark-32x32.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL_URLS).catch((error) => {
        console.log("[Melodia SW] App shell cache skipped:", error)
      })
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
  if (IS_LOCAL_DEV && (request.mode === "navigate" || isNextStaticRequest(url) || isStaticAssetRequest(url))) return

  if (isMediaRequest(url)) {
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
    const response = await fetch(request)
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
