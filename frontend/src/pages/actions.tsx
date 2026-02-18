import { useState } from "react"
import {
  useSendText,
  useSendImage,
  useSendDocument,
  useSendAudio,
  useSendVideo,
  useSendSticker,
  useSendLocation,
  useSendContact,
  useReact,
  useMarkRead,
  useSendPresence,
  useUpdateProfileStatus,
  useChats,
} from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Send, UserRound, Smile, Eye, Radio } from "lucide-react"
import { useContactMap, resolveJid } from "@/hooks/use-contact-map"
import { toast } from "sonner"

function JidInput({
  value,
  onChange,
  label = "Recipient JID",
}: {
  value: string
  onChange: (v: string) => void
  label?: string
}) {
  const contactMap = useContactMap()
  const { data: chats } = useChats({ search: value || undefined, limit: 10 })

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="number@s.whatsapp.net or group@g.us"
        className="h-9 font-mono text-sm"
        list="jid-suggestions"
      />
      {chats?.data && chats.data.length > 0 && (
        <datalist id="jid-suggestions">
          {chats.data.map((c) => (
            <option key={c.jid} value={c.jid}>
              {c.name || resolveJid(c.jid, contactMap)}
            </option>
          ))}
        </datalist>
      )}
    </div>
  )
}

function SendMessageTab() {
  const [msgType, setMsgType] = useState("text")
  const [jid, setJid] = useState("")
  const [text, setText] = useState("")
  const [caption, setCaption] = useState("")
  const [url, setUrl] = useState("")
  const [filename, setFilename] = useState("")
  const [mimeType, setMimeType] = useState("")
  const [ptt, setPtt] = useState(false)
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [locName, setLocName] = useState("")
  const [locAddress, setLocAddress] = useState("")
  const [contactJid, setContactJid] = useState("")
  const [contactName, setContactName] = useState("")
  const [quotedId, setQuotedId] = useState("")

  const sendText = useSendText()
  const sendImage = useSendImage()
  const sendDocument = useSendDocument()
  const sendAudio = useSendAudio()
  const sendVideo = useSendVideo()
  const sendSticker = useSendSticker()
  const sendLocation = useSendLocation()
  const sendContact = useSendContact()

  const isPending =
    sendText.isPending ||
    sendImage.isPending ||
    sendDocument.isPending ||
    sendAudio.isPending ||
    sendVideo.isPending ||
    sendSticker.isPending ||
    sendLocation.isPending ||
    sendContact.isPending

  function handleSend() {
    if (!jid.trim()) {
      toast.error("Recipient JID required")
      return
    }

    const opts = {
      onSuccess: () => toast.success("Message sent!"),
      onError: (e: Error) => toast.error(e.message),
    }

    switch (msgType) {
      case "text":
        if (!text.trim()) return toast.error("Text required")
        sendText.mutate({ jid, text, quoted_id: quotedId || undefined }, opts)
        break
      case "image":
        if (!url.trim()) return toast.error("URL required")
        sendImage.mutate({ jid, url, caption: caption || undefined }, opts)
        break
      case "video":
        if (!url.trim()) return toast.error("URL required")
        sendVideo.mutate({ jid, url, caption: caption || undefined }, opts)
        break
      case "audio":
        if (!url.trim()) return toast.error("URL required")
        sendAudio.mutate({ jid, url, ptt }, opts)
        break
      case "document":
        if (!url.trim() || !filename.trim() || !mimeType.trim())
          return toast.error("URL, filename, and MIME type required")
        sendDocument.mutate(
          { jid, url, filename, mime_type: mimeType, caption: caption || undefined },
          opts
        )
        break
      case "sticker":
        if (!url.trim()) return toast.error("URL required")
        sendSticker.mutate({ jid, url }, opts)
        break
      case "location":
        if (!latitude || !longitude) return toast.error("Coordinates required")
        sendLocation.mutate(
          {
            jid,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            name: locName || undefined,
            address: locAddress || undefined,
          },
          opts
        )
        break
      case "contact":
        if (!contactJid.trim() || !contactName.trim())
          return toast.error("Contact JID and name required")
        sendContact.mutate({ jid, contact_jid: contactJid, name: contactName }, opts)
        break
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4" />
          Send Message
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <JidInput value={jid} onChange={setJid} />

        <div className="space-y-1.5">
          <Label className="text-xs">Message Type</Label>
          <Select value={msgType} onValueChange={setMsgType}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="document">Document</SelectItem>
              <SelectItem value="sticker">Sticker</SelectItem>
              <SelectItem value="location">Location</SelectItem>
              <SelectItem value="contact">Contact</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Dynamic Fields */}
        {msgType === "text" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Text</Label>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Message text..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quote Message ID (optional)</Label>
              <Input value={quotedId} onChange={(e) => setQuotedId(e.target.value)} placeholder="Message ID to quote" className="h-9" />
            </div>
          </>
        )}

        {(msgType === "image" || msgType === "video" || msgType === "audio" || msgType === "sticker") && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://... or file://..." className="h-9" />
            </div>
            {(msgType === "image" || msgType === "video") && (
              <div className="space-y-1.5">
                <Label className="text-xs">Caption (optional)</Label>
                <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" className="h-9" />
              </div>
            )}
            {msgType === "audio" && (
              <div className="flex items-center gap-2">
                <Switch checked={ptt} onCheckedChange={setPtt} />
                <Label className="text-xs">Push-to-talk (voice note)</Label>
              </div>
            )}
          </>
        )}

        {msgType === "document" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Filename</Label>
                <Input value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="report.pdf" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">MIME Type</Label>
                <Input value={mimeType} onChange={(e) => setMimeType(e.target.value)} placeholder="application/pdf" className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Caption (optional)</Label>
              <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" className="h-9" />
            </div>
          </>
        )}

        {msgType === "location" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Latitude</Label>
                <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="37.7749" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Longitude</Label>
                <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="-122.4194" className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name (optional)</Label>
              <Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Place name" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Address (optional)</Label>
              <Input value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="Address" className="h-9" />
            </div>
          </>
        )}

        {msgType === "contact" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Contact JID</Label>
              <Input value={contactJid} onChange={(e) => setContactJid(e.target.value)} placeholder="number@s.whatsapp.net" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Display Name</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="John Doe" className="h-9" />
            </div>
          </>
        )}

        <Button onClick={handleSend} disabled={isPending} className="w-full">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </Button>
      </CardContent>
    </Card>
  )
}

function QuickActionsTab() {
  const [reactJid, setReactJid] = useState("")
  const [reactMsgId, setReactMsgId] = useState("")
  const [reactEmoji, setReactEmoji] = useState("")
  const [readJid, setReadJid] = useState("")
  const [readMsgIds, setReadMsgIds] = useState("")
  const [presenceType, setPresenceType] = useState("available")
  const [presenceJid, setPresenceJid] = useState("")
  const [profileStatus, setProfileStatus] = useState("")

  const react = useReact()
  const markRead = useMarkRead()
  const sendPresence = useSendPresence()
  const updateProfile = useUpdateProfileStatus()

  function handleReact() {
    if (!reactJid || !reactMsgId || !reactEmoji) return toast.error("All fields required")
    react.mutate(
      { jid: reactJid, message_id: reactMsgId, emoji: reactEmoji },
      {
        onSuccess: () => toast.success("Reaction sent"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handleMarkRead() {
    if (!readJid || !readMsgIds) return toast.error("JID and message IDs required")
    markRead.mutate(
      {
        jid: readJid,
        message_ids: readMsgIds.split(",").map((s) => s.trim()),
      },
      {
        onSuccess: () => toast.success("Marked as read"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handlePresence() {
    sendPresence.mutate(
      { type: presenceType, jid: presenceJid || undefined },
      {
        onSuccess: () => toast.success("Presence sent"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handleProfileStatus() {
    if (!profileStatus.trim()) return toast.error("Status text required")
    updateProfile.mutate(
      { status: profileStatus },
      {
        onSuccess: () => toast.success("Profile status updated"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* React */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Smile className="h-4 w-4" />
            React to Message
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={reactJid} onChange={(e) => setReactJid(e.target.value)} placeholder="Chat JID" className="h-9 font-mono text-sm" />
          <Input value={reactMsgId} onChange={(e) => setReactMsgId(e.target.value)} placeholder="Message ID" className="h-9 font-mono text-sm" />
          <Input value={reactEmoji} onChange={(e) => setReactEmoji(e.target.value)} placeholder="Emoji (e.g. 👍)" className="h-9" />
          <Button onClick={handleReact} disabled={react.isPending} size="sm" className="w-full">
            {react.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "React"}
          </Button>
        </CardContent>
      </Card>

      {/* Mark Read */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Mark as Read
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={readJid} onChange={(e) => setReadJid(e.target.value)} placeholder="Chat JID" className="h-9 font-mono text-sm" />
          <Input value={readMsgIds} onChange={(e) => setReadMsgIds(e.target.value)} placeholder="Message IDs (comma-separated)" className="h-9 font-mono text-sm" />
          <Button onClick={handleMarkRead} disabled={markRead.isPending} size="sm" className="w-full">
            {markRead.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark Read"}
          </Button>
        </CardContent>
      </Card>

      {/* Presence */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Send Presence
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={presenceType} onValueChange={setPresenceType}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
              <SelectItem value="composing">Composing</SelectItem>
              <SelectItem value="recording">Recording</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
          <Input value={presenceJid} onChange={(e) => setPresenceJid(e.target.value)} placeholder="JID (optional, for typing indicators)" className="h-9 font-mono text-sm" />
          <Button onClick={handlePresence} disabled={sendPresence.isPending} size="sm" className="w-full">
            {sendPresence.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send"}
          </Button>
        </CardContent>
      </Card>

      {/* Profile Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            Profile Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={profileStatus} onChange={(e) => setProfileStatus(e.target.value)} placeholder="New status text..." rows={3} />
          <Button onClick={handleProfileStatus} disabled={updateProfile.isPending} size="sm" className="w-full">
            {updateProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Update"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function ActionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Actions</h1>
        <p className="text-sm text-muted-foreground">Send messages and manage presence</p>
      </div>

      <Tabs defaultValue="send">
        <TabsList>
          <TabsTrigger value="send">Send Message</TabsTrigger>
          <TabsTrigger value="quick">Quick Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="send" className="mt-4">
          <div className="max-w-lg">
            <SendMessageTab />
          </div>
        </TabsContent>

        <TabsContent value="quick" className="mt-4">
          <QuickActionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
