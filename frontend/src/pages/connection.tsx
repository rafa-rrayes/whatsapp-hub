import {
  useConnectionStatus,
  useQRCode,
  useRestartConnection,
  useNewQR,
  useLogout,
} from "@/hooks/use-api"
import { useWebSocketStore } from "@/stores/websocket"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Wifi,
  WifiOff,
  RefreshCw,
  LogOut,
  Loader2,
  QrCode,
  Radio,
  Smartphone,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { resolveJid } from "@/hooks/use-contact-map"
import { formatDatetime } from "@/lib/utils"
import { toast } from "sonner"

const statusConfig: Record<
  string,
  { label: string; color: string; dotColor: string; icon: typeof Wifi }
> = {
  connected: {
    label: "Connected",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotColor: "bg-emerald-400",
    icon: Wifi,
  },
  open: {
    label: "Connected",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotColor: "bg-emerald-400",
    icon: Wifi,
  },
  connecting: {
    label: "Connecting",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotColor: "bg-amber-400 animate-pulse",
    icon: Clock,
  },
  qr: {
    label: "Waiting for QR scan",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotColor: "bg-blue-400 animate-pulse",
    icon: QrCode,
  },
  disconnected: {
    label: "Disconnected",
    color: "bg-muted text-muted-foreground border-border",
    dotColor: "bg-muted-foreground",
    icon: WifiOff,
  },
}

function getConfig(status: string | undefined) {
  return statusConfig[status || "disconnected"] || statusConfig.disconnected
}

function StatusBanner({ status, jid }: { status: string; jid?: string }) {
  const config = getConfig(status)
  const Icon = config.icon
  const isConnected = status === "open" || status === "connected"

  return (
    <Card
      className={cn(
        "border",
        isConnected ? "border-emerald-500/20" : "border-border"
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
              isConnected
                ? "bg-emerald-500/10"
                : status === "qr"
                  ? "bg-blue-500/10"
                  : "bg-muted"
            )}
          >
            <Icon
              className={cn(
                "h-6 w-6",
                isConnected
                  ? "text-emerald-400"
                  : status === "qr"
                    ? "text-blue-400"
                    : "text-muted-foreground"
              )}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold">{config.label}</h2>
              <Badge variant="outline" className={cn("text-xs", config.color)}>
                <div className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", config.dotColor)} />
                {status || "unknown"}
              </Badge>
            </div>
            {jid ? (
              <p className="text-sm text-muted-foreground mt-0.5">
                Signed in as{" "}
                <span className="font-mono text-foreground">
                  {resolveJid(jid, new Map())}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">
                {status === "qr"
                  ? "Scan the QR code below with your WhatsApp mobile app"
                  : status === "connecting"
                    ? "Establishing connection to WhatsApp servers..."
                    : "No active WhatsApp session"}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function QRCodeCard() {
  const { data: status } = useConnectionStatus()
  const { data: qr, isLoading: qrLoading } = useQRCode(status?.hasQR === true)
  const newQR = useNewQR()
  const isConnected = status?.status === "open" || status?.status === "connected"
  const isConnecting = status?.status === "connecting"

  if (isConnected) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            QR Code
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Already connected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your WhatsApp session is active. To re-link, use "Generate New QR" below.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                newQR.mutate(undefined, {
                  onSuccess: () => toast.success("Generating new QR code..."),
                  onError: (e) => toast.error(e.message),
                })
              }
              disabled={newQR.isPending}
              className="hover:text-destructive hover:border-destructive/50"
            >
              {newQR.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <QrCode className="h-3.5 w-3.5 mr-1.5" />
              )}
              Generate New QR
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status?.hasQR && qr?.qr) {
    return (
      <Card className="border-blue-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <QrCode className="h-4 w-4 text-blue-400" />
            Scan QR Code
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border border-border/50 bg-white p-3">
              <img
                src={qr.qr}
                alt="WhatsApp QR Code"
                className="h-56 w-56"
              />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">
                Open WhatsApp on your phone
              </p>
              <p className="text-xs text-muted-foreground max-w-[260px]">
                Go to Settings &gt; Linked Devices &gt; Link a Device, then point your phone at this QR code
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <QrCode className="h-4 w-4" />
          QR Code
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          {qrLoading ? (
            <Skeleton className="h-56 w-56 rounded-xl" />
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                {isConnecting ? (
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {isConnecting ? "Connecting..." : "No QR code available"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isConnecting
                    ? "If this takes too long, the old session may be stale. Generate a new QR to start fresh."
                    : "Clear the old session and generate a fresh QR code"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  newQR.mutate(undefined, {
                    onSuccess: () => toast.success("Generating new QR code..."),
                    onError: (e) => toast.error(e.message),
                  })
                }
                disabled={newQR.isPending}
              >
                {newQR.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <QrCode className="h-3.5 w-3.5 mr-1.5" />
                )}
                Generate New QR
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ControlsCard() {
  const { data: status } = useConnectionStatus()
  const restart = useRestartConnection()
  const newQR = useNewQR()
  const logout = useLogout()
  const isConnected = status?.status === "open" || status?.status === "connected"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Session Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Restart Connection</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drops and re-establishes the WhatsApp connection using existing
              credentials. Use this if messages are not syncing.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              restart.mutate(undefined, {
                onSuccess: () => toast.success("Reconnecting..."),
                onError: (e) => toast.error(e.message),
              })
            }
            disabled={restart.isPending}
            className="w-full"
          >
            {restart.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Restart Connection
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Generate New QR Code</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Clears saved credentials and generates a fresh QR code.
              Use this when the session is stale or stuck connecting.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              newQR.mutate(undefined, {
                onSuccess: () => toast.success("Generating new QR code..."),
                onError: (e) => toast.error(e.message),
              })
            }
            disabled={newQR.isPending}
            className="w-full"
          >
            {newQR.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <QrCode className="h-3.5 w-3.5 mr-1.5" />
            )}
            Generate New QR
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Logout</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ends the current session and unlinks this device from WhatsApp.
              You will need to scan a new QR code to reconnect.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => toast.success("Logged out"),
                onError: (e) => toast.error(e.message),
              })
            }
            disabled={logout.isPending || !isConnected}
            className="w-full hover:text-destructive hover:border-destructive/50"
          >
            {logout.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
            )}
            Logout
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function WebSocketCard() {
  const wsStatus = useWebSocketStore((s) => s.status)
  const eventCount = useWebSocketStore((s) => s.eventCount)
  const recentEvents = useWebSocketStore((s) => s.recentEvents)
  const clearEvents = useWebSocketStore((s) => s.clearEvents)

  const wsStatusColor: Record<string, string> = {
    connected: "text-emerald-400",
    connecting: "text-amber-400",
    disconnected: "text-muted-foreground",
    error: "text-destructive",
  }

  const wsDotColor: Record<string, string> = {
    connected: "bg-emerald-400",
    connecting: "bg-amber-400 animate-pulse",
    disconnected: "bg-muted-foreground",
    error: "bg-destructive",
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" />
            WebSocket
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-mono">
              {eventCount} events
            </Badge>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-1.5 w-1.5 rounded-full", wsDotColor[wsStatus])} />
              <span className={cn("text-xs", wsStatusColor[wsStatus])}>{wsStatus}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Real-time event stream from the backend. Events automatically update the UI.
        </div>
        {recentEvents.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Recent events</span>
              <Button variant="ghost" size="xs" onClick={clearEvents}>
                Clear
              </Button>
            </div>
            <ScrollArea className="h-48">
              <div className="space-y-1">
                {recentEvents.slice(0, 30).map((event, i) => (
                  <div
                    key={`${event.timestamp}-${i}`}
                    className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
                  >
                    <Badge variant="secondary" className="text-[10px] font-mono shrink-0 px-1.5 py-0">
                      {event.type}
                    </Badge>
                    <span className="text-muted-foreground shrink-0">
                      {formatDatetime(new Date(event.timestamp).toISOString())}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            No events yet
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ConnectionInfoCard() {
  const { data: status } = useConnectionStatus()
  const isConnected = status?.status === "open" || status?.status === "connected"

  if (!isConnected || !status?.jid) return null

  const phone = status.jid.split("@")[0]
  const phoneFormatted = phone ? `+${phone.replace(/:.*/, "")}` : "Unknown"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Session Info
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Phone</span>
            <span className="text-sm font-mono">{phoneFormatted}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">JID</span>
            <span className="text-xs font-mono text-muted-foreground max-w-[200px] truncate">
              {status.jid}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge
              variant="outline"
              className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs"
            >
              <div className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Active
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ConnectionPage() {
  const { data: status, isLoading } = useConnectionStatus()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connection</h1>
          <p className="text-sm text-muted-foreground">
            Manage your WhatsApp connection
          </p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connection</h1>
        <p className="text-sm text-muted-foreground">
          Manage your WhatsApp connection and linked device
        </p>
      </div>

      <StatusBanner status={status?.status || "disconnected"} jid={status?.jid} />

      <div className="grid gap-4 lg:grid-cols-2">
        <QRCodeCard />
        <div className="space-y-4">
          <ConnectionInfoCard />
          <ControlsCard />
        </div>
      </div>

      <WebSocketCard />
    </div>
  )
}
