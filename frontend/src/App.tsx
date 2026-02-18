import { Routes, Route } from "react-router-dom"
import { useAuthStore } from "@/stores/auth"
import { useWebSocket } from "@/hooks/use-websocket"
import { AuthGate } from "@/components/auth-gate"
import { AppShell } from "@/components/layout/app-shell"
import { OverviewPage } from "@/pages/overview"
import { MessagesPage } from "@/pages/messages"
import { ContactsPage } from "@/pages/contacts"
import { GroupsPage } from "@/pages/groups"
import { MediaPage } from "@/pages/media"
import { WebhooksPage } from "@/pages/webhooks"
import { EventsPage } from "@/pages/events"
import { ActionsPage } from "@/pages/actions"
import { ConnectionPage } from "@/pages/connection"
import { ApiDocsPage } from "@/pages/api-docs"

function AuthenticatedApp() {
  useWebSocket()

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="media" element={<MediaPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="connection" element={<ConnectionPage />} />
        <Route path="api-docs" element={<ApiDocsPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) {
    return <AuthGate />
  }

  return <AuthenticatedApp />
}
