import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  UsersRound,
  Image,
  Webhook,
  Activity,
  Zap,
  Wifi,
  LogOut,
  MessageCircle,
  BookOpen,
} from "lucide-react"
import { useAuthStore } from "@/stores/auth"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/messages", icon: MessageSquare, label: "Messages" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/groups", icon: UsersRound, label: "Groups" },
  { to: "/media", icon: Image, label: "Media" },
  { to: "/webhooks", icon: Webhook, label: "Webhooks" },
  { to: "/events", icon: Activity, label: "Events" },
  { to: "/actions", icon: Zap, label: "Actions" },
  { to: "/connection", icon: Wifi, label: "Connection" },
  { to: "/api-docs", icon: BookOpen, label: "API Docs" },
]

export function Sidebar() {
  const logout = useAuthStore((s) => s.logout)

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border/50 bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
          <MessageCircle className="h-4.5 w-4.5 text-primary" />
        </div>
        <span className="text-sm font-semibold tracking-tight">WhatsApp Hub</span>
      </div>

      <Separator className="opacity-50" />

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <Separator className="opacity-50" />

      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2.5 text-muted-foreground hover:text-destructive"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </aside>
  )
}
