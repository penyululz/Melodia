"use client"

import { useState } from "react"
import { UploadZone } from "@/components/upload/upload-zone"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FolderSync, Upload } from "lucide-react"
import { mutate } from "swr"
import { useSettingsStore } from "@/stores/settings-store"

export default function UploadPage() {
  const { onlineArtworkLookup } = useSettingsStore()
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{
    message: string
    added: number
    skipped: number
  } | null>(null)
  const [scanPath, setScanPath] = useState("")

  const handleScan = async () => {
    setScanning(true)
    setScanResult(null)

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-melodia-online-artwork": onlineArtworkLookup ? "true" : "false",
        },
        body: JSON.stringify({ directory: scanPath || undefined }),
      })

      const result = await response.json()
      setScanResult(result)

      // Revalidate all data
      mutate("/api/tracks")
      mutate("/api/albums")
      mutate("/api/artists")
      mutate("/api/genres")
      mutate("/api/stats")
    } catch (error) {
      console.error("Scan failed:", error)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Upload Music</h1>
        <p className="text-muted-foreground">
          Add music to your library by uploading files or scanning a folder
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upload Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Files
            </CardTitle>
            <CardDescription>
              Drag and drop music files or click to browse
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadZone />
          </CardContent>
        </Card>

        {/* Scan Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderSync className="h-5 w-5" />
              Scan Folder
            </CardTitle>
            <CardDescription>
              Scan a directory on the server for music files
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scan-path">Folder Path (optional)</Label>
              <Input
                id="scan-path"
                placeholder="Leave empty to scan default music folder"
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Default: /public/music in the application directory
              </p>
            </div>

            <Button
              onClick={handleScan}
              disabled={scanning}
              className="w-full"
            >
              {scanning ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Scanning...
                </>
              ) : (
                <>
                  <FolderSync className="mr-2 h-4 w-4" />
                  Scan Folder
                </>
              )}
            </Button>

            {scanResult && (
              <div className="rounded-md border bg-muted/50 p-4">
                <p className="font-medium">{scanResult.message}</p>
                <div className="mt-2 text-sm text-muted-foreground">
                  <p>Added: {scanResult.added} files</p>
                  <p>Skipped: {scanResult.skipped} files (already in library)</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
