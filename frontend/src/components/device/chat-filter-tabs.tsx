import { useDeviceStore, type FilterTab } from "@/stores/device"
import { cn } from "@/lib/utils"

const TABS: Array<{ key: FilterTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "favourites", label: "Favourites" },
  { key: "groups", label: "Groups" },
]

export function ChatFilterTabs() {
  const filterTab = useDeviceStore((s) => s.filterTab)
  const setFilterTab = useDeviceStore((s) => s.setFilterTab)

  return (
    <div className="flex gap-2 px-3 pb-2">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setFilterTab(tab.key)}
          className={cn(
            "rounded-full px-3 py-1 text-sm",
            filterTab === tab.key
              ? "bg-wa-accent/20 text-wa-accent"
              : "bg-wa-panel text-wa-text-muted hover:bg-wa-panel-active"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
