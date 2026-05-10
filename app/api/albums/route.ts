import { NextResponse } from "next/server"
import { queries } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const albums = queries.getAlbums.all()
    return NextResponse.json({ albums })
  } catch (error) {
    console.error("Error fetching albums:", error)
    return NextResponse.json(
      { error: "Failed to fetch albums" },
      { status: 500 }
    )
  }
}
