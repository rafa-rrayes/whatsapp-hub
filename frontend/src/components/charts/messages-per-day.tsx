import { useDashboardStats } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { format, parseISO } from "date-fns"

export function MessagesPerDayChart() {
  const { data, isLoading } = useDashboardStats()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-52 w-full" />
        </CardContent>
      </Card>
    )
  }

  const chartData = (data?.messages.byDay || [])
    .slice()
    .reverse()
    .map((d) => ({
      day: d.day,
      label: format(parseISO(d.day), "MMM d"),
      count: d.count,
    }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Messages per Day</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.67 0.17 162)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.67 0.17 162)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0 0)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.17 0 0)",
                  border: "1px solid oklch(0.3 0 0)",
                  borderRadius: "8px",
                  fontSize: 12,
                  color: "oklch(0.985 0 0)",
                }}
                labelFormatter={(label) => label}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="oklch(0.67 0.17 162)"
                strokeWidth={2}
                fill="url(#msgGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
