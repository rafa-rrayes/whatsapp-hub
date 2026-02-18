import { useState } from "react"
import { useContacts } from "@/hooks/use-api"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, X, User, Building2 } from "lucide-react"
import { formatDatetime } from "@/lib/utils"
import { resolveJid } from "@/hooks/use-contact-map"

export function ContactsPage() {
  const [search, setSearch] = useState("")
  const [expandedJid, setExpandedJid] = useState<string | null>(null)
  const { data, isLoading } = useContacts(search || undefined)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total} contacts` : "Loading..."}
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
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
                  <TableHead className="w-52">Name</TableHead>
                  <TableHead className="w-52">JID</TableHead>
                  <TableHead className="w-36">Phone</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead>First Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.map((contact) => (
                  <>
                    <TableRow
                      key={contact.jid}
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedJid(expandedJid === contact.jid ? null : contact.jid)
                      }
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <span className="truncate">
                            {contact.name || contact.notify_name || resolveJid(contact.jid, new Map())}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {contact.jid}
                      </TableCell>
                      <TableCell className="text-sm">
                        {contact.phone_number || "—"}
                      </TableCell>
                      <TableCell>
                        {contact.is_business ? (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Building2 className="h-3 w-3" />
                            Business
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Personal
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDatetime(contact.first_seen_at)}
                      </TableCell>
                    </TableRow>
                    {expandedJid === contact.jid && (
                      <TableRow key={`${contact.jid}-detail`}>
                        <TableCell colSpan={5} className="bg-muted/30 p-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5 text-sm">
                              <p>
                                <span className="text-muted-foreground">Notify Name: </span>
                                {contact.notify_name || "—"}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Short Name: </span>
                                {contact.short_name || "—"}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Status: </span>
                                {contact.status_text || "—"}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Updated: </span>
                                {formatDatetime(contact.updated_at)}
                              </p>
                            </div>
                            {contact.profile_pic_url && (
                              <div>
                                <img
                                  src={contact.profile_pic_url}
                                  alt="Profile"
                                  className="h-20 w-20 rounded-full object-cover"
                                />
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                {data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No contacts found
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
