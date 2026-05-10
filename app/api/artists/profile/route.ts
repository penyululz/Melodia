import { NextRequest, NextResponse } from "next/server"
import { getArtistProfileImage } from "@/lib/artist-profile"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim()
  if (!artist) {
    return NextResponse.json({ error: "Artist is required" }, { status: 400 })
  }

  try {
    const imagePath = await getArtistProfileImage(artist)
    return NextResponse.json({
      artist,
      image_path: imagePath,
    })
  } catch (error) {
    console.error("[artist-profile] error:", error)
    return NextResponse.json({ artist, image_path: null })
  }
}
