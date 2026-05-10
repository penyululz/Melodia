/**
 * Server-safe content utilities for YouTube tracks
 * These are duplicated from settings-store for server-side use
 */

// Content type detection helpers
export function detectContentType(title: string): "official" | "video" | "live" | "cover" | "remix" | "podcast" | "unknown" {
  const lowerTitle = title.toLowerCase()
  
  if (/(^|[\s._-])(podcast|episode|interview|spoken word)([\s._-]|$)/.test(lowerTitle)) {
    return "podcast"
  }
  if (lowerTitle.includes("(official audio)") || lowerTitle.includes("- audio")) {
    return "official"
  }
  if (lowerTitle.includes("(official video)") || lowerTitle.includes("(music video)") || lowerTitle.includes("(official music video)")) {
    return "video"
  }
  if (lowerTitle.includes("(live)") || lowerTitle.includes("live at") || lowerTitle.includes("live from") || lowerTitle.includes("- live")) {
    return "live"
  }
  if (lowerTitle.includes("(cover)") || lowerTitle.includes("cover by") || lowerTitle.includes("- cover")) {
    return "cover"
  }
  if (lowerTitle.includes("(remix)") || lowerTitle.includes("remix)") || lowerTitle.includes("- remix")) {
    return "remix"
  }
  
  return "unknown"
}

// Normalize song title for duplicate detection
export function normalizeSongTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(official.*?\)/gi, "")
    .replace(/\(music video\)/gi, "")
    .replace(/\(audio\)/gi, "")
    .replace(/\(lyrics?\)/gi, "")
    .replace(/\(visualizer\)/gi, "")
    .replace(/\(hd\)/gi, "")
    .replace(/\(hq\)/gi, "")
    .replace(/\(4k\)/gi, "")
    .replace(/\[.*?\]/g, "")
    .replace(/ft\.?|feat\.?/gi, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Check if video has music video content
export function hasVideoContent(title: string): boolean {
  const type = detectContentType(title)
  return type === "video" || type === "live"
}
