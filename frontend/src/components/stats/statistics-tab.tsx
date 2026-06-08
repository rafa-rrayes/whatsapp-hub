import { useMemo, useState } from "react"
import { useMessageAnalytics, useDashboardStats } from "@/hooks/use-api"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatBytes, formatTimestamp } from "@/lib/utils"
import {
  MessageSquare,
  Send,
  Inbox,
  Type,
  CalendarDays,
  TrendingUp,
  Image as ImageIcon,
  Forward,
  Smile,
  Star,
  Pencil,
  Trash2,
} from "lucide-react"
import {
  ActivityHeatmap,
  MessagesPerDaySplit,
  HourDistribution,
  WeekdayDistribution,
  DirectionDonut,
  TypeBreakdown,
  MediaBreakdown,
  TopChatsTable,
  TopSenders,
  TopEmojis,
} from "./charts"

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
  { value: "all", label: "All time" },
]

interface Kpi {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: string
  sub?: string
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{kpi.label}</span>
          <kpi.icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="text-xl font-semibold tabular-nums">{kpi.value}</div>
        {kpi.sub && <div className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</div>}
      </CardContent>
    </Card>
  )
}

export function StatisticsTab() {
  const [range, setRange] = useState("90")
  const [chat, setChat] = useState("all")
  const contactMap = useContactMap()

  const params = useMemo(
    () => ({
      days: range === "all" ? undefined : Number(range),
      chat: chat === "all" ? undefined : chat,
    }),
    [range, chat]
  )

  const { data, isLoading } = useMessageAnalytics(params)
  const { data: dashboard } = useDashboardStats()

  // Chat options come from the all-time top chats so the selector is stable
  // regardless of the active range filter.
  const chatOptions = useMemo(
    () => (dashboard?.messages.byChat ?? []).slice(0, 25),
    [dashboard]
  )

  const kpis = useMemo<Kpi[]>(() => {
    if (!data) return []
    const t = data.totals
    const sentPct = t.total > 0 ? Math.round((t.sent / t.total) * 100) : 0
    const avgPerDay = t.activeDays > 0 ? Math.round(t.total / t.activeDays) : 0
    const wordsPerMsg = t.total > 0 ? (t.words / t.total).toFixed(1) : "0"

    const busiest = data.byDay.reduce(
      (best, d) => (d.total > best.total ? d : best),
      { day: "", total: 0 }
    )
    const peakHour = data.byHour.reduce(
      (best, h) => (h.count > best.count ? h : best),
      { hour: 0, count: 0 }
    )

    const list: Kpi[] = [
      { label: "Messages", icon: MessageSquare, value: t.total.toLocaleString() },
      { label: "Sent", icon: Send, value: t.sent.toLocaleString(), sub: `${sentPct}% of total` },
      { label: "Received", icon: Inbox, value: t.received.toLocaleString(), sub: `${100 - sentPct}% of total` },
      { label: "Words", icon: Type, value: t.words.toLocaleString(), sub: `${wordsPerMsg} / msg` },
      { label: "Active days", icon: CalendarDays, value: t.activeDays.toLocaleString() },
      { label: "Avg / active day", icon: TrendingUp, value: avgPerDay.toLocaleString() },
      {
        label: "Busiest day",
        icon: CalendarDays,
        value: busiest.total.toLocaleString(),
        sub: busiest.day || "—",
      },
      {
        label: "Peak hour",
        icon: TrendingUp,
        value: `${String(peakHour.hour).padStart(2, "0")}:00`,
        sub: `${peakHour.count.toLocaleString()} msgs`,
      },
      { label: "Media", icon: ImageIcon, value: t.media.toLocaleString(), sub: formatBytes(data.media.totalSize) },
      { label: "Forwarded", icon: Forward, value: t.forwarded.toLocaleString() },
      { label: "Reactions", icon: Smile, value: t.reactions.toLocaleString() },
      { label: "Starred", icon: Star, value: t.starred.toLocaleString() },
      { label: "Edited", icon: Pencil, value: t.edited.toLocaleString() },
      { label: "Deleted", icon: Trash2, value: t.deleted.toLocaleString() },
    ]
    return list
  }, [data])

  const rangeNote = useMemo(() => {
    if (!data?.range.firstTs || !data.range.lastTs) return null
    return `${formatTimestamp(data.range.firstTs)} → ${formatTimestamp(data.range.lastTs)}`
  }, [data])

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={chat} onValueChange={setChat}>
            <SelectTrigger className="h-9 w-64">
              <SelectValue placeholder="All chats" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All chats</SelectItem>
              {chatOptions.map((c) => (
                <SelectItem key={c.remote_jid} value={c.remote_jid}>
                  {resolveJid(c.remote_jid, contactMap)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {rangeNote && <span className="text-xs text-muted-foreground">{rangeNote}</span>}
      </div>

      {isLoading || !data ? (
        <StatsSkeleton />
      ) : data.totals.total === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No messages match this filter.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {kpis.map((kpi) => (
              <KpiCard key={kpi.label} kpi={kpi} />
            ))}
          </div>

          {/* Trend over time */}
          <MessagesPerDaySplit data={data.byDay} />

          {/* When + how often */}
          <ActivityHeatmap data={data.heatmap} />
          <div className="grid gap-4 lg:grid-cols-2">
            <HourDistribution data={data.byHour} />
            <WeekdayDistribution data={data.byWeekday} />
          </div>

          {/* Composition */}
          <div className="grid gap-4 lg:grid-cols-3">
            <DirectionDonut totals={data.totals} />
            <TypeBreakdown data={data.byType} />
            <MediaBreakdown media={data.media} />
          </div>

          {/* Who */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TopChatsTable data={data.byChat} contactMap={contactMap} />
            <TopSenders data={data.topSenders} contactMap={contactMap} />
          </div>

          {/* Reactions */}
          <TopEmojis data={data.topEmojis} />
        </>
      )}
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="mb-2 h-4 w-16" />
              <Skeleton className="h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-60 w-full" />
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    </div>
  )
}
