import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { DEMO_USER } from "@/lib/demo-data"
import { isDemoSessionEnabled } from "@/lib/auth-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const user = await getSession()
    if (user) return NextResponse.json({ user })

    if (isDemoSessionEnabled()) {
      return NextResponse.json({ user: DEMO_USER, demo: true })
    }

    return NextResponse.json({ user: null })
  } catch (error) {
    console.error("[v0] Session error:", error)
    return NextResponse.json({ user: isDemoSessionEnabled() ? DEMO_USER : null })
  }
}
