import "server-only"

import fs from "fs"
import path from "path"
import { SUPPORTED_SUBTITLE_FORMATS, getFileExtension } from "@/lib/format"

const PREFERRED_LANGUAGE_HINTS = ["en", "eng", "default"]

export function findSidecarSubtitle(mediaPath: string): string | null {
  const directory = path.dirname(mediaPath)
  const baseName = path.basename(mediaPath, path.extname(mediaPath)).toLowerCase()

  if (!fs.existsSync(directory)) return null

  const candidates = fs
    .readdirSync(directory)
    .filter((entry) => {
      const ext = getFileExtension(entry)
      if (!SUPPORTED_SUBTITLE_FORMATS.includes(ext)) return false

      const entryBase = path.basename(entry, ext).toLowerCase()
      return entryBase === baseName || entryBase.startsWith(`${baseName}.`)
    })
    .map((entry) => path.join(directory, entry))

  candidates.sort((left, right) => scoreSubtitle(right, baseName) - scoreSubtitle(left, baseName))

  return candidates[0] || null
}

export function readSubtitleAsWebVtt(filePath: string): string | null {
  const ext = getFileExtension(filePath)
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")

  if (ext === ".vtt") {
    return raw.trimStart().startsWith("WEBVTT") ? raw : `WEBVTT\n\n${raw}`
  }

  if (ext === ".srt") {
    return srtToVtt(raw)
  }

  if (ext === ".ass" || ext === ".ssa") {
    return assToVtt(raw)
  }

  if (ext === ".sbv") {
    return sbvToVtt(raw)
  }

  return null
}

function scoreSubtitle(filePath: string, mediaBaseName: string): number {
  const ext = getFileExtension(filePath)
  const base = path.basename(filePath, ext).toLowerCase()
  let score = ext === ".vtt" ? 100 : ext === ".srt" ? 80 : 40

  if (base === mediaBaseName) score += 30
  if (PREFERRED_LANGUAGE_HINTS.some((hint) => base.endsWith(`.${hint}`))) score += 20

  return score
}

function srtToVtt(input: string): string {
  const body = input
    .replace(/\r/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3}\s+-->)/gm, "")
    .trim()

  return `WEBVTT\n\n${body}\n`
}

function sbvToVtt(input: string): string {
  const body = input
    .replace(/\r/g, "")
    .replace(/^(\d+:\d{2}:\d{2}\.\d{3}),(\d+:\d{2}:\d{2}\.\d{3})$/gm, (_match, start, end) => {
      return `${normalizeTimestamp(start)} --> ${normalizeTimestamp(end)}`
    })
    .trim()

  return `WEBVTT\n\n${body}\n`
}

function assToVtt(input: string): string | null {
  const lines = input.replace(/\r/g, "").split("\n")
  const formatLine = lines.find((line) => line.trim().toLowerCase().startsWith("format:"))
  const fields = formatLine
    ? formatLine
        .slice(formatLine.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase())
    : []
  const startIndex = fields.indexOf("start")
  const endIndex = fields.indexOf("end")
  const textIndex = fields.indexOf("text")
  const cues: string[] = []

  for (const line of lines) {
    if (!line.trim().toLowerCase().startsWith("dialogue:")) continue

    const values = splitAssDialogue(line.slice(line.indexOf(":") + 1), fields.length || 10)
    const start = values[startIndex >= 0 ? startIndex : 1]
    const end = values[endIndex >= 0 ? endIndex : 2]
    const text = values[textIndex >= 0 ? textIndex : 9]

    if (!start || !end || !text) continue

    cues.push(
      `${assTimeToVtt(start)} --> ${assTimeToVtt(end)}\n${cleanAssText(text)}`
    )
  }

  return cues.length ? `WEBVTT\n\n${cues.join("\n\n")}\n` : null
}

function splitAssDialogue(value: string, expectedFields: number): string[] {
  const parts = value.split(",")
  if (parts.length <= expectedFields) return parts.map((part) => part.trim())

  const head = parts.slice(0, expectedFields - 1)
  const text = parts.slice(expectedFields - 1).join(",")
  return [...head, text].map((part) => part.trim())
}

function cleanAssText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\h/g, " ")
    .trim()
}

function assTimeToVtt(value: string): string {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,2})$/)
  if (!match) return normalizeTimestamp(value)

  const hours = match[1].padStart(2, "0")
  const minutes = match[2]
  const seconds = match[3]
  const millis = match[4].padEnd(3, "0").slice(0, 3)
  return `${hours}:${minutes}:${seconds}.${millis}`
}

function normalizeTimestamp(value: string): string {
  const parts = value.trim().split(":")
  if (parts.length === 3) return `${parts[0].padStart(2, "0")}:${parts[1]}:${parts[2]}`
  if (parts.length === 2) return `00:${parts[0].padStart(2, "0")}:${parts[1]}`
  return value.trim()
}
