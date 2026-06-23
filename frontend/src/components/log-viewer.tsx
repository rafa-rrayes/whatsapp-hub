import { useEffect, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"

// pino numeric levels → display label + colour.
const LEVELS: Record<number, { label: string; cls: string }> = {
  10: { label: "TRACE", cls: "text-zinc-500" },
  20: { label: "DEBUG", cls: "text-zinc-400" },
  30: { label: "INFO", cls: "text-sky-400" },
  40: { label: "WARN", cls: "text-amber-400" },
  50: { label: "ERROR", cls: "text-red-400" },
  60: { label: "FATAL", cls: "text-red-500" },
}

interface ParsedLine {
  raw: string
  time?: string
  level?: { label: string; cls: string }
  component?: string
  msg?: string
}

function parseLine(raw: string): ParsedLine {
  try {
    const o = JSON.parse(raw)
    if (typeof o !== "object" || o === null) return { raw }
    const time =
      typeof o.time === "number"
        ? new Date(o.time).toLocaleTimeString(undefined, { hour12: false })
        : undefined
    const level = LEVELS[o.level as number]
    const msg =
      typeof o.msg === "string"
        ? o.msg
        : o.err?.message ?? o.error?.message ?? undefined
    return { raw, time, level, component: o.component, msg }
  } catch {
    return { raw }
  }
}

export function LogViewer({ lines }: { lines: string[] }) {
  const parsed = useMemo(() => lines.map(parseLine), [lines])
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep the newest lines in view as the buffer refreshes.
  useEffect(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [parsed.length])

  if (lines.length === 0) {
    return (
      <div className="rounded-md bg-zinc-950 py-12 text-center text-sm text-zinc-400">
        No logs captured yet
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="max-h-[600px] overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200"
    >
      {parsed.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap break-all py-px">
          {l.level ? (
            <>
              {l.time && <span className="text-zinc-500">{l.time} </span>}
              <span className={cn("font-semibold", l.level.cls)}>
                {l.level.label.padEnd(5)}{" "}
              </span>
              {l.component && <span className="text-zinc-400">[{l.component}] </span>}
              <span>{l.msg ?? l.raw}</span>
            </>
          ) : (
            <span className="text-zinc-300">{l.raw}</span>
          )}
        </div>
      ))}
    </div>
  )
}
