"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Upload, Music, X, Check, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { mutate } from "swr"
import { useSettingsStore } from "@/stores/settings-store"
import {
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_SUBTITLE_FORMATS,
  SUPPORTED_VIDEO_FORMATS,
} from "@/lib/format"

interface UploadFile {
  file: File
  status: "pending" | "uploading" | "success" | "error"
  error?: string
}

export function UploadZone() {
  const { onlineArtworkLookup } = useSettingsStore()
  const [files, setFiles] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      status: "pending" as const,
    }))
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "audio/*": SUPPORTED_AUDIO_FORMATS,
      "video/*": SUPPORTED_VIDEO_FORMATS,
      "text/vtt": [".vtt"],
      "application/x-subrip": [".srt"],
      "text/plain": SUPPORTED_SUBTITLE_FORMATS,
    },
  })

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const uploadFiles = async () => {
    if (files.length === 0) return

    setUploading(true)
    setProgress(0)

    const pendingFiles = files.filter((f) => f.status === "pending")
    const totalFiles = pendingFiles.length
    let completed = 0

    for (let i = 0; i < pendingFiles.length; i++) {
      const { file } = pendingFiles[i]

      setFiles((prev) =>
        prev.map((f) =>
          f.file === file ? { ...f, status: "uploading" } : f
        )
      )

      try {
        const formData = new FormData()
        formData.append("files", file)

        const response = await fetch("/api/tracks", {
          method: "POST",
          headers: {
            "x-melodia-online-artwork": onlineArtworkLookup ? "true" : "false",
          },
          body: formData,
        })

        const result = await response.json()

        if (
          response.ok &&
          (result.results?.success?.length > 0 || result.results?.sidecars?.length > 0)
        ) {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === file ? { ...f, status: "success" } : f
            )
          )
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === file
                ? {
                    ...f,
                    status: "error",
                    error: result.results?.errors?.[0] || "Upload failed",
                  }
                : f
            )
          )
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === file
              ? { ...f, status: "error", error: "Network error" }
              : f
          )
        )
      }

      completed++
      setProgress((completed / totalFiles) * 100)
    }

    setUploading(false)
    mutate("/api/tracks")
    mutate("/api/albums")
    mutate("/api/artists")
    mutate("/api/stats")
  }

  const clearCompleted = () => {
    setFiles((prev) => prev.filter((f) => f.status !== "success"))
  }

  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
        <p className="mb-2 text-lg font-medium">
          {isDragActive ? "Drop your music here" : "Drag and drop music files"}
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          or click to browse your files
        </p>
        <p className="text-xs text-muted-foreground">
          Supports audio, video, hi-fi files, TS video, and subtitle sidecars
        </p>
      </div>

      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Files ({files.length})</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearCompleted}>
                Clear Completed
              </Button>
              <Button
                size="sm"
                onClick={uploadFiles}
                disabled={uploading || files.every((f) => f.status !== "pending")}
              >
                {uploading ? "Uploading..." : "Upload All"}
              </Button>
            </div>
          </div>

          {uploading && <Progress value={progress} />}

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {files.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <Music className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(item.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                {item.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {item.status === "uploading" && (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
                {item.status === "success" && (
                  <Check className="h-5 w-5 text-green-500" />
                )}
                {item.status === "error" && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <span className="text-xs text-destructive">
                      {item.error}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
