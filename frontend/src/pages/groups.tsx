import { useState } from "react"
import {
  useGroups,
  useGroup,
  useGroupInviteCode,
  useUpdateGroupSubject,
  useUpdateGroupDescription,
  useGroupParticipants,
  useSyncGroups,
} from "@/hooks/use-api"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, X, Users, Settings, Link, Loader2, RefreshCw } from "lucide-react"
import { formatDatetime } from "@/lib/utils"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"
import { toast } from "sonner"

function GroupManageDialog({ jid, contactMap }: { jid: string; contactMap: Map<string, string> }) {
  const { data: group } = useGroup(jid)
  const { data: inviteData } = useGroupInviteCode(jid)
  const updateSubject = useUpdateGroupSubject()
  const updateDescription = useUpdateGroupDescription()
  const manageParticipants = useGroupParticipants()
  const [newSubject, setNewSubject] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [participantJid, setParticipantJid] = useState("")
  const [participantAction, setParticipantAction] = useState<"add" | "remove" | "promote" | "demote">("add")

  function handleUpdateSubject() {
    if (!newSubject.trim()) return
    updateSubject.mutate(
      { jid, subject: newSubject },
      {
        onSuccess: () => {
          toast.success("Subject updated")
          setNewSubject("")
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handleUpdateDescription() {
    updateDescription.mutate(
      { jid, description: newDescription },
      {
        onSuccess: () => {
          toast.success("Description updated")
          setNewDescription("")
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handleParticipantAction() {
    if (!participantJid.trim()) return
    manageParticipants.mutate(
      { jid, participants: [participantJid], action: participantAction },
      {
        onSuccess: () => {
          toast.success(`Participant ${participantAction}ed`)
          setParticipantJid("")
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{group?.name || resolveJid(jid, contactMap)}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {/* Subject */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Update Subject</label>
          <div className="flex gap-2">
            <Input
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder={group?.name || "Group name"}
              className="h-9"
            />
            <Button size="sm" onClick={handleUpdateSubject} disabled={updateSubject.isPending}>
              {updateSubject.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Update Description</label>
          <Textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder={group?.description || "Group description"}
            rows={3}
          />
          <Button
            size="sm"
            onClick={handleUpdateDescription}
            disabled={updateDescription.isPending}
          >
            {updateDescription.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>

        {/* Invite Code */}
        {inviteData?.code && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Invite Link</label>
            <div className="flex items-center gap-2">
              <Input
                value={`https://chat.whatsapp.com/${inviteData.code}`}
                readOnly
                className="h-9 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(`https://chat.whatsapp.com/${inviteData.code}`)
                  toast.success("Copied!")
                }}
              >
                <Link className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Participants Management */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Manage Participants</label>
          <div className="flex gap-2">
            <Input
              value={participantJid}
              onChange={(e) => setParticipantJid(e.target.value)}
              placeholder="Participant JID"
              className="h-9 flex-1"
            />
            <Select
              value={participantAction}
              onValueChange={(v) => setParticipantAction(v as typeof participantAction)}
            >
              <SelectTrigger className="h-9 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add</SelectItem>
                <SelectItem value="remove">Remove</SelectItem>
                <SelectItem value="promote">Promote</SelectItem>
                <SelectItem value="demote">Demote</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleParticipantAction} disabled={manageParticipants.isPending}>
              {manageParticipants.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
            </Button>
          </div>
        </div>

        {/* Participants List */}
        {group?.participants && group.participants.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Participants ({group.participants.length})
            </label>
            <div className="max-h-40 overflow-auto rounded-md border">
              {group.participants.map((p) => (
                <div
                  key={p.participant_jid}
                  className="flex items-center justify-between px-3 py-1.5 text-xs border-b last:border-0"
                >
                  <span>{resolveJid(p.participant_jid, contactMap)}</span>
                  <Badge variant={p.role === "admin" || p.role === "superadmin" ? "default" : "outline"} className="text-xs">
                    {p.role}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  )
}

export function GroupsPage() {
  const [search, setSearch] = useState("")
  const contactMap = useContactMap()
  const { data, isLoading } = useGroups(search || undefined)
  const syncGroups = useSyncGroups()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} groups` : "Loading..."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            syncGroups.mutate(undefined, {
              onSuccess: (result: any) =>
                toast.success(`Synced ${result.synced} groups`),
              onError: (e) => toast.error(e.message),
            })
          }
          disabled={syncGroups.isPending}
        >
          {syncGroups.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Sync Groups
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search groups..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-60">Name</TableHead>
                  <TableHead className="w-24">Members</TableHead>
                  <TableHead className="w-32">Owner</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.map((group) => (
                  <TableRow key={group.jid}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{group.name || resolveJid(group.jid, contactMap)}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">
                            {group.jid}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{group.participant_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {group.owner_jid ? resolveJid(group.owner_jid, contactMap) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDatetime(group.first_seen_at)}
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon-xs">
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                        </DialogTrigger>
                        <GroupManageDialog jid={group.jid} contactMap={contactMap} />
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
                {data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No groups found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
