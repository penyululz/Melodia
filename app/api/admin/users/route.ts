import { NextResponse } from "next/server"
import { queries } from "@/lib/db"
import { authErrorResponse, requireAdminAccess } from "@/lib/auth-policy"

export async function GET() {
  try {
    await requireAdminAccess()
    const users = queries.getAllUsers.all()
    return NextResponse.json({ users })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
  }
}
