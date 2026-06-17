import { useEffect, useRef, useState } from "react"
import { Play, Pause, Mic, Loader2 } from "lucide-react"
import { useMediaBlob } from "@/hooks/use-media-blob"
import { formatDuration } from "../format"
import type { Message } from "@/lib/types"

const SPEEDS = [1, 1.5, 2]

export function AudioPlayer({ message }: { message: Message }) {
  const { url, loading } = useMediaBlob(message.media_id)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(message.media_duration ?? 0)
  const [speedIdx, setSpeedIdx] = useState(0)

  // Pause on unmount; re-bind when the <audio> mounts (url arrives async).
  useEffect(() => {
    const audio = audioRef.current
    return () => audio?.pause()
  }, [url])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.playbackRate = SPEEDS[speedIdx]
      audio.play()
    }
  }

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = (Number(e.target.value) / 100) * duration
  }

  const isPtt = message.message_type === "audio" // ptt + audio share rendering; mic shown for voice notes

  return (
    <div className="flex w-[280px] items-center gap-2 py-1">
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setProgress(0)
            setCurrentTime(0)
          }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget
            setCurrentTime(a.currentTime)
            if (a.duration > 0) setProgress((a.currentTime / a.duration) * 100)
          }}
        />
      )}
      {isPtt && <Mic className="h-5 w-5 shrink-0 text-wa-text-muted" />}
      <button
        onClick={toggle}
        disabled={!url}
        className="shrink-0 text-wa-icon disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : playing ? (
          <Pause className="h-8 w-8" fill="currentColor" />
        ) : (
          <Play className="h-8 w-8" fill="currentColor" />
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={100}
          value={progress}
          onChange={seek}
          className="h-1 w-full cursor-pointer accent-wa-accent"
        />
        <div className="flex justify-between text-[11px] text-wa-text-muted">
          <span>{playing ? formatDuration(currentTime) : formatDuration(duration)}</span>
          {playing && (
            <button onClick={cycleSpeed} className="rounded-full bg-wa-panel-active px-1.5 font-medium">
              {SPEEDS[speedIdx]}×
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
