"use client"

import useSWR from "swr"
import {
  useSettingsStore,
  QUALITY_LABELS,
  EQ_PRESETS,
  DEFAULT_EQ_BANDS,
  type StreamingQuality,
} from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Slider } from "@/components/ui/slider"
import {
  Settings,
  Wifi,
  Download,
  HardDriveDownload,
  Filter,
  Copy,
  Sliders,
  VolumeX,
  Eye,
  History,
  RotateCcw,
  ImageIcon,
  KeyRound,
  Podcast,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const FREQ_LABELS: Record<number, string> = {
  60: "60Hz",
  170: "170Hz",
  310: "310Hz",
  600: "600Hz",
  1000: "1kHz",
  3000: "3kHz",
  6000: "6kHz",
  12000: "12kHz",
  14000: "14kHz",
  16000: "16kHz",
}

const fetcher = (url: string) => fetch(url).then((response) => response.json())

export default function SettingsPage() {
  const settings = useSettingsStore()
  const { data: integrationStatus } = useSWR("/api/integrations/status", fetcher)
  const {
    streamingQuality, downloadQuality,
    autoDownloadLibraryActions,
    alwaysHighQuality, dataSaver,
    eqEnabled, eqBands,
    showMusicVideos, showLivePerformances, showCovers, showRemixes, showPodcasts,
    preferOfficialAudio, hideDuplicates,
    pauseWatchHistory, pauseSearchHistory,
    onlineArtworkLookup, preferOfficialYouTubeApi,
    setStreamingQuality, setDownloadQuality,
    setAutoDownloadLibraryActions,
    setAlwaysHighQuality, setDataSaver,
    setEqEnabled, setEqBand, applyEqPreset,
    setShowMusicVideos, setShowLivePerformances, setShowCovers, setShowRemixes, setShowPodcasts,
    setPreferOfficialAudio, setHideDuplicates,
    setPauseWatchHistory, setPauseSearchHistory,
    setOnlineArtworkLookup, setPreferOfficialYouTubeApi,
  } = settings

  const resetEQ = () => {
    applyEqPreset("Flat")
    toast.success("Equalizer reset to flat")
  }

  const clearHistory = async () => {
    await fetch("/api/history", { method: "DELETE" })
    toast.success("Listen history cleared")
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground leading-relaxed">Customize your listening experience</p>
      </div>

      {/* Equalizer */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Sliders className="h-5 w-5" />
              Equalizer
            </CardTitle>
            <div className="flex items-center gap-2">
              <Switch
                id="eq-enabled"
                checked={eqEnabled}
                onCheckedChange={setEqEnabled}
              />
              <Label htmlFor="eq-enabled" className="text-sm">
                {eqEnabled ? "On" : "Off"}
              </Label>
            </div>
          </div>
          <CardDescription>Fine-tune frequencies for the best sound</CardDescription>
        </CardHeader>
        <CardContent className={cn("space-y-5", !eqEnabled && "opacity-50 pointer-events-none")}>
          {/* Preset buttons */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Presets</p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(EQ_PRESETS).map((preset) => {
                const isActive = eqEnabled &&
                  eqBands.every((b, i) => b.gain === (EQ_PRESETS[preset][i] ?? 0))
                return (
                  <Button
                    key={preset}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => applyEqPreset(preset)}
                  >
                    {preset}
                  </Button>
                )
              })}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={resetEQ}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Reset
              </Button>
            </div>
          </div>

          {/* Band sliders */}
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="flex min-w-[500px] items-end gap-2 sm:min-w-0">
              {eqBands.map((band, i) => (
                <div key={i} className="flex min-w-10 flex-1 flex-col items-center gap-2">
                  <span className={cn(
                    "w-8 text-center font-mono text-[10px] tabular-nums",
                    band.gain > 0 ? "text-primary" : band.gain < 0 ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {band.gain > 0 ? `+${band.gain}` : band.gain}
                  </span>
                  <div className="flex h-28 items-center justify-center">
                    <Slider
                      orientation="vertical"
                      min={-12}
                      max={12}
                      step={1}
                      value={[band.gain]}
                      onValueChange={([v]) => setEqBand(i, v)}
                      className="h-full"
                    />
                  </div>
                  <span className="w-10 text-center text-[8px] leading-none text-muted-foreground sm:text-[9px]">
                    {FREQ_LABELS[band.freq] ?? `${band.freq}Hz`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <VolumeX className="h-5 w-5" />
            Audio
          </CardTitle>
          <CardDescription>Volume and quality adjustments</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Audio Normalization</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Always keeps volume consistent across all tracks
              </p>
            </div>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Always on
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Streaming Quality */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Streaming Quality
          </CardTitle>
          <CardDescription>Higher quality uses more data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={streamingQuality}
            onValueChange={(v) => setStreamingQuality(v as StreamingQuality)}
            disabled={dataSaver || alwaysHighQuality}
          >
            {(Object.entries(QUALITY_LABELS) as [StreamingQuality, typeof QUALITY_LABELS.high][]).map(
              ([key, { label, bitrate, description }]) => (
                <div key={key} className="flex items-center space-x-3 py-1.5">
                  <RadioGroupItem value={key} id={`quality-${key}`} />
                  <Label htmlFor={`quality-${key}`} className="flex-1 cursor-pointer">
                    <span className="font-medium">{label}</span>{" "}
                    <span className="text-muted-foreground text-sm">({bitrate})</span>
                    <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                  </Label>
                </div>
              )
            )}
          </RadioGroup>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label htmlFor="always-high">Always High Quality</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Prevents automatic quality reduction
              </p>
            </div>
            <Switch
              id="always-high"
              checked={alwaysHighQuality}
              onCheckedChange={setAlwaysHighQuality}
              disabled={dataSaver}
            />
          </div>
        </CardContent>
      </Card>

      {/* Download Quality */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Download Quality
          </CardTitle>
          <CardDescription>Quality used when saving tracks for offline play</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              variant={downloadQuality === "normal" ? "default" : "outline"}
              onClick={() => setDownloadQuality("normal")}
              className="flex-1"
            >
              Normal (128kbps)
            </Button>
            <Button
              variant={downloadQuality === "high" ? "default" : "outline"}
              onClick={() => setDownloadQuality("high")}
              className="flex-1"
            >
              High (256kbps)
            </Button>
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label htmlFor="auto-download-library-actions" className="flex items-center gap-2">
                <HardDriveDownload className="h-4 w-4" />
                Auto-download liked and playlist songs
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Saves online songs locally when you favorite them or add them to playlists
              </p>
            </div>
            <Switch
              id="auto-download-library-actions"
              checked={autoDownloadLibraryActions}
              onCheckedChange={setAutoDownloadLibraryActions}
            />
          </div>
        </CardContent>
      </Card>

      {/* Artwork */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Artwork
          </CardTitle>
          <CardDescription>Album covers for uploaded and scanned files</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="online-artwork">Online Artwork Lookup</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Uses cached Google image lookup only when embedded artwork is missing
              </p>
            </div>
            <Switch
              id="online-artwork"
              checked={onlineArtworkLookup}
              onCheckedChange={setOnlineArtworkLookup}
              disabled={!integrationStatus?.googleCustomSearch?.configured}
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Embedded metadata artwork is always preferred. If online lookup is off or unavailable,
            Melodia generates a local WebP cover automatically.
          </p>
        </CardContent>
      </Card>

      {/* Cloud APIs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Cloud APIs
          </CardTitle>
          <CardDescription>Optional Google Cloud keys with cache-first quota protection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="official-youtube-api">Prefer Official YouTube Data API</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Uses your Google Cloud API key for search only when configured and under budget
              </p>
            </div>
            <Switch
              id="official-youtube-api"
              checked={preferOfficialYouTubeApi}
              onCheckedChange={setPreferOfficialYouTubeApi}
              disabled={!integrationStatus?.youtubeDataApi?.configured}
            />
          </div>

          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="font-medium text-foreground">YouTube Data API</p>
              <p>{integrationStatus?.youtubeDataApi?.configured ? "Configured" : "Not configured"}</p>
              <p>
                {integrationStatus?.youtubeDataApi?.quota?.used ?? 0}/
                {integrationStatus?.youtubeDataApi?.quota?.dailyBudget ?? 0} units today
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground">Google Image Lookup</p>
              <p>{integrationStatus?.googleCustomSearch?.configured ? "Configured" : "Not configured"}</p>
              <p>
                {integrationStatus?.googleCustomSearch?.quota?.used ?? 0}/
                {integrationStatus?.googleCustomSearch?.quota?.dailyBudget ?? 0} lookups today
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Saver */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Data Saver
          </CardTitle>
          <CardDescription>Reduce data usage by lowering quality and disabling video</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="data-saver">Enable Data Saver</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Forces audio-only mode and normal quality
              </p>
            </div>
            <Switch id="data-saver" checked={dataSaver} onCheckedChange={setDataSaver} />
          </div>
        </CardContent>
      </Card>

      {/* Content Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Content Filters
          </CardTitle>
          <CardDescription>Choose what types of content appear in search results</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { id: "show-videos", label: "Music Videos", value: showMusicVideos, setter: setShowMusicVideos },
            { id: "show-live", label: "Live Performances", value: showLivePerformances, setter: setShowLivePerformances },
            { id: "show-covers", label: "Covers", value: showCovers, setter: setShowCovers },
            { id: "show-remixes", label: "Remixes", value: showRemixes, setter: setShowRemixes },
            { id: "show-podcasts", label: "Podcasts", value: showPodcasts, setter: setShowPodcasts },
          ].map(({ id, label, value, setter }) => (
            <div key={id} className="flex items-center justify-between">
              <Label htmlFor={id} className="flex items-center gap-2">
                {id === "show-podcasts" && <Podcast className="h-4 w-4 text-muted-foreground" />}
                {label}
              </Label>
              <Switch id={id} checked={value} onCheckedChange={setter} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Duplicate Handling */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Duplicate Handling
          </CardTitle>
          <CardDescription>Control how duplicate versions of songs are shown</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="hide-duplicates">Hide Duplicates</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">Show only one version per song</p>
            </div>
            <Switch id="hide-duplicates" checked={hideDuplicates} onCheckedChange={setHideDuplicates} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="prefer-official">Prefer Official Audio</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pick official versions when hiding duplicates
              </p>
            </div>
            <Switch
              id="prefer-official"
              checked={preferOfficialAudio}
              onCheckedChange={setPreferOfficialAudio}
              disabled={!hideDuplicates}
            />
          </div>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Privacy
          </CardTitle>
          <CardDescription>Control what activity is recorded for recommendations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pause-watch">Pause Watch History</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Stops recording tracks you play
              </p>
            </div>
            <Switch
              id="pause-watch"
              checked={pauseWatchHistory}
              onCheckedChange={setPauseWatchHistory}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pause-search">Pause Search History</Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Stops recording your search queries
              </p>
            </div>
            <Switch
              id="pause-search"
              checked={pauseSearchHistory}
              onCheckedChange={setPauseSearchHistory}
            />
          </div>
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Clear Listen History</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Removes all recorded listens — this affects your mixes
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={clearHistory}
              >
                <History className="mr-2 h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
