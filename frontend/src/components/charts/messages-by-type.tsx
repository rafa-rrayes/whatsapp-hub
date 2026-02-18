import { useDashboardStats } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"

const COLORS = [
  "oklch(0.67 0.17 162)",
  "oklch(0.6 0.15 200)",
  "oklch(0.55 0.15 250)",
  "oklch(0.65 0.18 80)",
  "oklch(0.55 0.2 27)",
  "oklch(0.7 0.12 300)",
  "oklch(0.5 0.15 150)",
  "oklch(0.6 0.18 30)",
]

export function MessagesByTypeChart() {
  const { data, isLoading } = useDashboardStats()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-52 w-full" />
        </CardContent>
      </Card>
    )
  }

  const chartData = (data?.messages.byType || []).slice(0, 8).map((d) => ({
    name: d.message_type || "unknown",
    value: d.count,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Messages by Type</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
              >
                {chartData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "oklch(0.17 0 0)",
                  border: "1px solid oklch(0.3 0 0)",
                  borderRadius: "8px",
                  fontSize: 12,
                  color: "oklch(0.985 0 0)",
                }}
              />
              <Legend
                formatter={(value) => (
                  <span style={{ color: "oklch(0.65 0 0)", fontSize: 11 }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
