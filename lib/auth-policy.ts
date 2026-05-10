import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { DEMO_USER } from "@/lib/demo-data"
import { getSession, getSessionUser, type AuthUser } from "@/lib/auth"

export class AuthPolicyError extends Error {
  status: 401 | 403

  constructor(message: "Unauthorized" | "Forbidden", status: 401 | 403) {
    super(message)
    this.name = "AuthPolicyError"
    this.status = status
  }
}

export function isDemoSessionEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MELODIA_DEMO_MODE === "1"
}

export async function getSessionOrDemo(request?: NextRequest): Promise<AuthUser | null> {
  const user = request ? await getSessionUser(request) : await getSession()
  if (user) return user
  return isDemoSessionEnabled() ? DEMO_USER : null
}

export async function requireMutationAuth(request?: NextRequest): Promise<AuthUser> {
  const user = await getSessionOrDemo(request)
  if (!user) throw new AuthPolicyError("Unauthorized", 401)
  return user
}

export async function requireAdminAccess(request?: NextRequest): Promise<AuthUser> {
  const user = await requireMutationAuth(request)
  if (user.role !== "admin") throw new AuthPolicyError("Forbidden", 403)
  return user
}

export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthPolicyError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (error instanceof Error && error.message === "Forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return null
}
