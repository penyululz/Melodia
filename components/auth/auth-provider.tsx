"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuthStore } from "@/stores/auth-store"

const PUBLIC_PATHS = ["/login", "/register"]

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading, setUser, setLoading } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session")
        if (!res.ok) throw new Error("Session request failed")
        const data = await res.json()
        setUser(data.user)
      } catch {
        const cachedUser = useAuthStore.getState().user
        if (typeof navigator !== "undefined" && !navigator.onLine && cachedUser) {
          setUser(cachedUser)
          return
        }
        setUser(null)
      }
    }

    loadSession()
  }, [setUser])

  useEffect(() => {
    if (isLoading) return

    const isPublicPath = PUBLIC_PATHS.includes(pathname)

    if (!user && !isPublicPath) {
      router.push("/login")
    } else if (user && isPublicPath) {
      router.push("/")
    }
  }, [user, isLoading, pathname, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Show pages without layout for login/register
  if (PUBLIC_PATHS.includes(pathname)) {
    return <>{children}</>
  }

  // Protected routes need a user
  if (!user) {
    return null
  }

  return <>{children}</>
}
