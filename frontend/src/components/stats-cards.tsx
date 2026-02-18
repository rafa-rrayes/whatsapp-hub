import { useDashboardStats } from "@/hooks/use-api"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { MessageSquare, Users, UsersRound, Image, Phone, MessagesSquare } from "lucide-react"
import { formatBytes } from "@/lib/utils"

const statConfig = [
  {
    key: "messages" as const,
    label: "Messages",
    icon: MessageSquare,
    getValue: (s: any) => s.messages.total.toLocaleString(),
  },
  {
    key: "contacts" as const,
    label: "Contacts",
    icon: Users,
    getValue: (s: any) => s.contacts.toLocaleString(),
  },
  {
    key: "groups" as const,
    label: "Groups",
    icon: UsersRound,
    getValue: (s: any) => s.groups.toLocaleString(),
  },
  {
    key: "media" as const,
    label: "Media",
    icon: Image,
    getValue: (s: any) => s.media.total.toLocaleString(),
    getSub: (s: any) => formatBytes(s.media.totalSize),
  },
  {
    key: "calls" as const,
    label: "Calls",
    icon: Phone,
    getValue: (s: any) => s.calls.toLocaleString(),
  },
  {
    key: "chats" as const,
    label: "Chats",
    icon: MessagesSquare,
    getValue: (s: any) => s.chats.toLocaleString(),
  },
]

export function StatsCards() {
  const { data, isLoading } = useDashboardStats()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {statConfig.map((stat) => (
        <Card key={stat.key}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{stat.label}</span>
              <stat.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-xl font-semibold">{stat.getValue(data)}</div>
            {stat.getSub && (
              <div className="text-xs text-muted-foreground mt-0.5">{stat.getSub(data)}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
