import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Search } from "lucide-react"
import { useContacts } from "@/hooks/use-api"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ChatAvatar } from "./chat-avatar"
import { displayName } from "./format"

export function NewChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const { data } = useContacts(search || undefined)

  const contacts = (data?.data ?? []).slice(0, 50)

  const openChat = (jid: string) => {
    onOpenChange(false)
    setSearch("")
    navigate(`/device/${encodeURIComponent(jid)}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col gap-0 border-none bg-wa-bg p-0 sm:max-w-[420px]">
        <div className="bg-wa-panel px-5 py-4">
          <DialogTitle className="text-[16px] font-medium text-wa-text">New chat</DialogTitle>
        </div>
        <div className="p-3">
          <div className="flex h-[35px] items-center gap-3 rounded-lg bg-wa-panel px-3">
            <Search className="h-4 w-4 shrink-0 text-wa-text-muted" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts"
              className="w-full bg-transparent text-sm text-wa-text outline-none placeholder:text-wa-text-muted"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map((c) => (
            <button
              key={c.jid}
              onClick={() => openChat(c.jid)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-wa-panel"
            >
              <ChatAvatar jid={c.jid} size={42} />
              <div className="min-w-0">
                <div className="truncate text-[16px] text-wa-text">
                  {displayName(c.name || c.notify_name, c.jid)}
                </div>
                {c.status_text && (
                  <div className="truncate text-[13px] text-wa-text-muted">{c.status_text}</div>
                )}
              </div>
            </button>
          ))}
          {contacts.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-wa-text-muted">No contacts found</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
