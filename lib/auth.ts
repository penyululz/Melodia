import "server-only"
import { cookies } from "next/headers"
import { SignJWT, jwtVerify } from "jose"
import { hash, compare } from "bcryptjs"
import { NextRequest } from "next/server"
import db, { queries, User } from "./db"
import crypto from "crypto"

const DEFAULT_JWT_SECRET = "melodia-music-player-secret-key-change-in-production"

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !process.env.JWT_SECRET
) {
  console.warn("[auth] JWT_SECRET is not set. Set a strong JWT_SECRET before exposing Melodia.")
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || DEFAULT_JWT_SECRET)

const COOKIE_NAME = "melodia_session"
const SESSION_DURATION_DAYS = 30

export interface AuthUser {
  id: number
  email: string
  name: string
  avatar_url: string | null
  role: string
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return compare(password, hashedPassword)
}

export async function createSession(userId: number, rememberMe: boolean = true): Promise<string> {
  const sessionId = crypto.randomUUID()
  const durationDays = rememberMe ? SESSION_DURATION_DAYS : 1 // 1 day for session-only
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + durationDays)

  queries.createSession.run(sessionId, userId, expiresAt.toISOString())

  // Create JWT token
  const token = await new SignJWT({ sessionId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${durationDays}d`)
    .sign(JWT_SECRET)

  // Set cookie — no expires for session-only (browser closes = logout)
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    ...(rememberMe ? { expires: expiresAt } : {}),
    path: "/",
  })

  return sessionId
}

export async function getSession(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value

    if (!token) return null

    const { payload } = await jwtVerify(token, JWT_SECRET)
    const sessionId = payload.sessionId as string

    if (!sessionId) return null

    const session = queries.getSessionById.get(sessionId) as any
    if (!session) return null

    return {
      id: session.user_id,
      email: session.user_email,
      name: session.user_name,
      avatar_url: null,
      role: session.user_role,
    }
  } catch {
    return null
  }
}

export async function deleteSession(): Promise<void> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE_NAME)?.value

    if (token) {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      const sessionId = payload.sessionId as string
      if (sessionId) {
        queries.deleteSession.run(sessionId)
      }
    }

    cookieStore.delete(COOKIE_NAME)
  } catch {
    // Ignore errors during logout
  }
}

export async function register(
  email: string,
  password: string,
  name: string
): Promise<{ success: boolean; error?: string; user?: AuthUser }> {
  try {
    // Check if user already exists
    const existingUser = queries.getUserByEmail.get(email) as User | null
    if (existingUser) {
      return { success: false, error: "Email already registered" }
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Determine role (first user is admin)
    const allUsers = queries.getAllUsers.all()
    const role = allUsers.length === 0 ? "admin" : "user"

    // Create user
    const result = queries.createUser.run(email, passwordHash, name, null, role)
    const userId = (result as any).lastInsertRowid as number

    // Create session
    await createSession(userId)

    return {
      success: true,
      user: {
        id: userId,
        email,
        name,
        avatar_url: null,
        role,
      },
    }
  } catch (error) {
    console.error("[v0] Registration error:", error)
    return { success: false, error: "Registration failed" }
  }
}

export async function login(
  email: string,
  password: string,
  rememberMe: boolean = true
): Promise<{ success: boolean; error?: string; user?: AuthUser }> {
  try {
    const user = queries.getUserByEmail.get(email) as User | null

    if (!user) {
      return { success: false, error: "Invalid email or password" }
    }

    if (!user.is_active) {
      return { success: false, error: "Account is disabled" }
    }

    const isValidPassword = await verifyPassword(password, user.password_hash)
    if (!isValidPassword) {
      return { success: false, error: "Invalid email or password" }
    }

    // Create session with rememberMe option
    await createSession(user.id, rememberMe)

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        role: user.role,
      },
    }
  } catch (error) {
    console.error("[v0] Login error:", error)
    return { success: false, error: "Login failed" }
  }
}

export async function logout(): Promise<void> {
  await deleteSession()
}

// Get session from a NextRequest (for Route Handlers)
export async function getSessionUser(req: NextRequest): Promise<AuthUser | null> {
  try {
    const token = req.cookies.get(COOKIE_NAME)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, JWT_SECRET)
    const sessionId = payload.sessionId as string
    if (!sessionId) return null
    const session = queries.getSessionById.get(sessionId) as any
    if (!session) return null
    return {
      id: session.user_id,
      email: session.user_email,
      name: session.user_name,
      avatar_url: null,
      role: session.user_role,
    }
  } catch {
    return null
  }
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getSession()
  if (!user) {
    throw new Error("Unauthorized")
  }
  return user
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireAuth()
  if (user.role !== "admin") {
    throw new Error("Forbidden")
  }
  return user
}
