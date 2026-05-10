import { NextResponse } from "next/server"
import { queries } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const artists = queries.getArtists.all()
    return NextResponse.json({ artists })
  } catch (error) {
    console.error("Error fetching artists:", error)
    return NextResponse.json(
      { error: "Failed to fetch artists" },
      { status: 500 }
    )
  }
}
