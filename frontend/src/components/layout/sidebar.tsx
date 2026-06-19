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
  Plug,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react"
import { useAuthStore } from "@/stores/auth"
import { useSidebarStore } from "@/stores/sidebar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/api-docs", icon: BookOpen, label: "API Docs" },
  { to: "/mcp", icon: Plug, label: "MCP" },
]

interface SidebarProps {
  onMobileClose?: () => void
}

export function Sidebar({ onMobileClose }: SidebarProps) {
  const logout = useAuthStore((s) => s.logout)
  const { collapsed, toggle } = useSidebarStore()

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border/50 bg-sidebar transition-[width] duration-200 overflow-hidden",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-5",
          collapsed && "justify-center"
        )}
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <MessageCircle className="h-4.5 w-4.5 text-primary" />
        </div>

        {!collapsed && (
          <span className="flex-1 truncate text-sm font-semibold tracking-tight">
            WhatsApp Hub
          </span>
        )}

        {/* Desktop: collapse toggle */}
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground md:flex"
            onClick={toggle}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Mobile: close drawer */}
        {onMobileClose && !collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="flex h-7 w-7 flex-shrink-0 text-muted-foreground md:hidden"
            onClick={onMobileClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Separator className="opacity-50" />

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {navItems.map((item) => {
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={onMobileClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )
              }
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && item.label}
            </NavLink>
          )

          if (collapsed) {
            return (
              <Tooltip key={item.to} delayDuration={0}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            )
          }

          return link
        })}
      </nav>

      <Separator className="opacity-50" />

      {/* Bottom actions */}
      <div className="space-y-0.5 p-2">
        {/* Collapse toggle (desktop only) */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "hidden w-full text-muted-foreground hover:text-foreground md:flex",
                collapsed ? "justify-center px-0" : "justify-start gap-2.5"
              )}
              onClick={toggle}
            >
              <ChevronRight className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>Collapse</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Expand sidebar</TooltipContent>}
        </Tooltip>

        {/* Sign out */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "w-full text-muted-foreground hover:text-destructive",
                collapsed ? "justify-center px-0" : "justify-start gap-2.5"
              )}
              onClick={logout}
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              {!collapsed && "Sign Out"}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Sign Out</TooltipContent>}
        </Tooltip>
      </div>
    </aside>
  )
}
