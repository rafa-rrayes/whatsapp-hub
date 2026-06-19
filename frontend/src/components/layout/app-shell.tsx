import { Outlet } from "react-router-dom"
import { Sidebar } from "./sidebar"
import { ActivityBar } from "./activity-bar"
import { useSidebarStore } from "@/stores/sidebar"
import { cn } from "@/lib/utils"
import { Menu, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

export function AppShell() {
  const { mobileOpen, setMobileOpen } = useSidebarStore()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — fixed overlay on mobile, in-flow on desktop */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-30 transition-transform duration-200",
          "md:relative md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar onMobileClose={() => setMobileOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
              <MessageCircle className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-semibold tracking-tight">WhatsApp Hub</span>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
        <ActivityBar />
      </div>
    </div>
  )
}
