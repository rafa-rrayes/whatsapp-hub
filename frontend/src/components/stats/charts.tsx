import { useMemo } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CHART, PALETTE, TOOLTIP_STYLE } from "./chart-theme"
import { resolveJid } from "@/hooks/use-contact-map"
import { formatBytes, formatTimestamp } from "@/lib/utils"
import type { MessageAnalytics } from "@/lib/types"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// ── Shared card wrapper ───────────────────────────────────────────
function ChartCard({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

// ── Activity heatmap (weekday × hour) ─────────────────────────────
export function ActivityHeatmap({ data }: { data: MessageAnalytics["heatmap"] }) {
  const { matrix, max, peak } = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
    let mx = 0
    let pk = { weekday: 0, hour: 0, count: 0 }
    for (const cell of data) {
      if (cell.weekday < 0 || cell.weekday > 6) continue
      m[cell.weekday][cell.hour] = cell.count
      if (cell.count > mx) mx = cell.count
      if (cell.count > pk.count) pk = { weekday: cell.weekday, hour: cell.hour, count: cell.count }
    }
    return { matrix: m, max: mx, peak: pk }
  }, [data])

  return (
    <ChartCard
      title="Activity Heatmap"
      action={
        max > 0 ? (
          <span className="text-xs text-muted-foreground">
            Peak: {WEEKDAYS[peak.weekday]} {String(peak.hour).padStart(2, "0")}:00 ·{" "}
            {peak.count.toLocaleString()} msgs
          </span>
        ) : undefined
      }
    >
      {max === 0 ? (
        <EmptyState label="No activity in this range" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="flex flex-col gap-1">
              {matrix.map((row, wd) => (
                <div key={wd} className="flex items-center gap-1">
                  <span className="w-8 shrink-0 text-[10px] text-muted-foreground">
                    {WEEKDAYS[wd]}
                  </span>
                  <div className="flex flex-1 gap-[3px]">
                    {row.map((count, hour) => {
                      const alpha = count === 0 ? 0 : 0.12 + 0.88 * (count / max)
                      return (
                        <div
                          key={hour}
                          title={`${WEEKDAYS[wd]} ${String(hour).padStart(2, "0")}:00 — ${count.toLocaleString()} messages`}
                          className="aspect-square flex-1 rounded-[2px]"
                          style={{
                            backgroundColor:
                              count === 0
                                ? "oklch(0.24 0 0)"
                                : `oklch(0.67 0.17 162 / ${alpha})`,
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
              {/* hour axis */}
              <div className="flex items-center gap-1 pt-0.5">
                <span className="w-8 shrink-0" />
                <div className="relative flex flex-1 gap-[3px]">
                  {Array.from({ length: 24 }).map((_, hour) => (
                    <span
                      key={hour}
                      className="flex-1 text-center text-[9px] text-muted-foreground"
                    >
                      {hour % 3 === 0 ? hour : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ChartCard>
  )
}

// ── Messages per day (sent / received stacked area) ───────────────
export function MessagesPerDaySplit({ data }: { data: MessageAnalytics["byDay"] }) {
  const chartData = useMemo(
    () =>
      data
        .slice()
        .reverse()
        .map((d) => {
          const [, mm, dd] = d.day.split("-")
          return { label: `${mm}/${dd}`, sent: d.sent, received: d.received }
        }),
    [data]
  )

  return (
    <ChartCard title="Messages per Day">
      {chartData.length === 0 ? (
        <EmptyState label="No messages in this range" />
      ) : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART.sent} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={CHART.sent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART.received} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={CHART.received} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area
                type="monotone"
                dataKey="received"
                name="Received"
                stackId="1"
                stroke={CHART.received}
                strokeWidth={2}
                fill="url(#gradReceived)"
              />
              <Area
                type="monotone"
                dataKey="sent"
                name="Sent"
                stackId="1"
                stroke={CHART.sent}
                strokeWidth={2}
                fill="url(#gradSent)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

// ── Hour-of-day distribution ──────────────────────────────────────
export function HourDistribution({ data }: { data: MessageAnalytics["byHour"] }) {
  const chartData = useMemo(() => {
    const byHour = new Map(data.map((d) => [d.hour, d.count]))
    return Array.from({ length: 24 }, (_, h) => ({
      hour: String(h).padStart(2, "0"),
      count: byHour.get(h) ?? 0,
    }))
  }, [data])

  return (
    <ChartCard title="By Hour of Day">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10, fill: CHART.axis }}
              tickLine={false}
              axisLine={false}
              interval={1}
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART.axis }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.3 0 0 / 0.3)" }} />
            <Bar dataKey="count" fill={CHART.sent} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

// ── Day-of-week distribution ──────────────────────────────────────
export function WeekdayDistribution({ data }: { data: MessageAnalytics["byWeekday"] }) {
  const chartData = useMemo(() => {
    const byWd = new Map(data.map((d) => [d.weekday, d.count]))
    return WEEKDAYS.map((label, wd) => ({ label, count: byWd.get(wd) ?? 0 }))
  }, [data])

  return (
    <ChartCard title="By Day of Week">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: CHART.axis }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART.axis }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.3 0 0 / 0.3)" }} />
            <Bar dataKey="count" fill={CHART.received} radius={[3, 3, 0, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

// ── Direction donut (sent vs received) ────────────────────────────
export function DirectionDonut({ totals }: { totals: MessageAnalytics["totals"] }) {
  const data = [
    { name: "Received", value: totals.received },
    { name: "Sent", value: totals.sent },
  ]
  const pct = totals.total > 0 ? Math.round((totals.sent / totals.total) * 100) : 0

  return (
    <ChartCard title="Sent vs Received">
      <div className="relative h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
            >
              <Cell fill={CHART.received} />
              <Cell fill={CHART.sent} />
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold">{pct}%</span>
          <span className="text-xs text-muted-foreground">sent</span>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.sent }} />
          Sent {totals.sent.toLocaleString()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.received }} />
          Received {totals.received.toLocaleString()}
        </span>
      </div>
    </ChartCard>
  )
}

// ── Message-type breakdown ────────────────────────────────────────
export function TypeBreakdown({ data }: { data: MessageAnalytics["byType"] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  const rows = data.slice(0, 10)

  return (
    <ChartCard title="Message Types">
      {rows.length === 0 ? (
        <EmptyState label="No messages in this range" />
      ) : (
        <div className="space-y-2.5">
          {rows.map((d, i) => {
            const pct = total > 0 ? (d.count / total) * 100 : 0
            return (
              <div key={d.message_type} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{d.message_type}</span>
                  <span className="text-muted-foreground">
                    {d.count.toLocaleString()} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ChartCard>
  )
}

// ── Media breakdown (count + size) ────────────────────────────────
export function MediaBreakdown({ media }: { media: MessageAnalytics["media"] }) {
  return (
    <ChartCard
      title="Media"
      action={
        <span className="text-xs text-muted-foreground">
          {media.total.toLocaleString()} files · {formatBytes(media.totalSize)}
        </span>
      }
    >
      {media.byKind.length === 0 ? (
        <EmptyState label="No media in this range" />
      ) : (
        <div className="space-y-3">
          {media.byKind.map((m, i) => {
            const pct = media.total > 0 ? (m.count / media.total) * 100 : 0
            return (
              <div key={m.kind} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium capitalize">{m.kind}</span>
                  <span className="text-muted-foreground">
                    {m.count.toLocaleString()} · {formatBytes(m.size)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ChartCard>
  )
}

// ── Top chats table ───────────────────────────────────────────────
export function TopChatsTable({
  data,
  contactMap,
}: {
  data: MessageAnalytics["byChat"]
  contactMap: Map<string, string>
}) {
  const rows = data.slice(0, 12)
  const max = rows.length > 0 ? rows[0].count : 0

  return (
    <ChartCard title="Top Chats">
      {rows.length === 0 ? (
        <EmptyState label="No chats in this range" />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const sentPct = c.count > 0 ? (c.sent / c.count) * 100 : 0
            return (
              <div key={c.remote_jid} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium" title={c.remote_jid}>
                    {resolveJid(c.remote_jid, contactMap)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {c.count.toLocaleString()}
                  </span>
                </div>
                <div
                  className="flex h-2 overflow-hidden rounded-full bg-muted"
                  style={{ width: `${max > 0 ? (c.count / max) * 100 : 0}%` }}
                  title={`${c.sent.toLocaleString()} sent · ${c.received.toLocaleString()} received · last ${formatTimestamp(c.last_ts)}`}
                >
                  <div className="h-full" style={{ width: `${sentPct}%`, background: CHART.sent }} />
                  <div className="h-full flex-1" style={{ background: CHART.received }} />
                </div>
              </div>
            )
          })}
          <div className="flex justify-end gap-3 pt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: CHART.sent }} /> sent
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: CHART.received }} /> received
            </span>
          </div>
        </div>
      )}
    </ChartCard>
  )
}

// ── Top senders (group participants) ──────────────────────────────
export function TopSenders({
  data,
  contactMap,
}: {
  data: MessageAnalytics["topSenders"]
  contactMap: Map<string, string>
}) {
  const chartData = useMemo(
    () =>
      data.slice(0, 12).map((s) => ({
        name: resolveJid(s.sender, contactMap),
        jid: s.sender,
        count: s.count,
      })),
    [data, contactMap]
  )

  return (
    <ChartCard title="Most Active People">
      {chartData.length === 0 ? (
        <EmptyState label="No group participants in this range" />
      ) : (
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "oklch(0.3 0 0 / 0.3)" }} />
              <Bar dataKey="count" fill={CHART.accent} radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

// ── Top emojis (reactions) ────────────────────────────────────────
export function TopEmojis({ data }: { data: MessageAnalytics["topEmojis"] }) {
  return (
    <ChartCard title="Top Reactions">
      {data.length === 0 ? (
        <EmptyState label="No reactions in this range" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((e) => (
            <Badge
              key={e.emoji}
              variant="secondary"
              className="gap-1.5 px-2.5 py-1 text-base font-normal"
            >
              <span>{e.emoji}</span>
              <span className="text-xs text-muted-foreground">{e.count.toLocaleString()}</span>
            </Badge>
          ))}
        </div>
      )}
    </ChartCard>
  )
}
