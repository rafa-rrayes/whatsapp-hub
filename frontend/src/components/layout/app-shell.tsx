import { Outlet } from "react-router-dom"
import { Sidebar } from "./sidebar"
import { ActivityBar } from "./activity-bar"

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
        <ActivityBar />
      </div>
    </div>
  )
}
