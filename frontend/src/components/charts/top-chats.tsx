import { useDashboardStats } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"

export function TopChatsChart() {
  const { data, isLoading } = useDashboardStats()
  const contactMap = useContactMap()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-52 w-full" />
        </CardContent>
      </Card>
    )
  }

  const chartData = (data?.messages.byChat || []).slice(0, 10).map((d) => ({
    name: resolveJid(d.remote_jid, contactMap),
    jid: d.remote_jid,
    count: d.count,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top Chats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0 0)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: "oklch(0.65 0 0)" }}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.17 0 0)",
                  border: "1px solid oklch(0.3 0 0)",
                  borderRadius: "8px",
                  fontSize: 12,
                  color: "oklch(0.985 0 0)",
                }}
              />
              <Bar
                dataKey="count"
                fill="oklch(0.67 0.17 162)"
                radius={[0, 4, 4, 0]}
                barSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
