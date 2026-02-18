import { useConnectionStatus, useQRCode, useRestartConnection, useNewQR, useLogout } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { RefreshCw, LogOut, Wifi, WifiOff, QrCode, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { resolveJid } from "@/hooks/use-contact-map"
import { toast } from "sonner"

export function ConnectionCard() {
  const { data: status, isLoading } = useConnectionStatus()
  const { data: qr } = useQRCode(status?.hasQR === true)
  const restart = useRestartConnection()
  const newQR = useNewQR()
  const logout = useLogout()

  const isConnected = status?.status === "open" || status?.status === "connected"

  function handleRestart() {
    restart.mutate(undefined, {
      onSuccess: () => toast.success("Reconnecting..."),
      onError: (e) => toast.error(e.message),
    })
  }

  function handleNewQR() {
    newQR.mutate(undefined, {
      onSuccess: () => toast.success("Generating new QR code..."),
      onError: (e) => toast.error(e.message),
    })
  }

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => toast.success("Logged out"),
      onError: (e) => toast.error(e.message),
    })
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Connection</CardTitle>
          <Badge
            variant={isConnected ? "default" : "secondary"}
            className={cn(
              "text-xs",
              isConnected && "bg-primary/15 text-primary border-primary/30"
            )}
          >
            <div
              className={cn(
                "mr-1 h-1.5 w-1.5 rounded-full",
                isConnected ? "bg-primary" : "bg-muted-foreground"
              )}
            />
            {status?.status || "unknown"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status?.jid && (
          <div className="flex items-center gap-2 text-sm">
            <Wifi className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Connected as</span>
            <span className="font-medium">{resolveJid(status.jid, new Map())}</span>
          </div>
        )}

        {!isConnected && !status?.hasQR && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4" />
            <span>Not connected</span>
          </div>
        )}

        {qr?.qr && (
          <div className="flex flex-col items-center gap-2 py-2">
            <p className="text-xs text-muted-foreground">Scan this QR code with WhatsApp</p>
            <img
              src={qr.qr}
              alt="QR Code"
              className="h-48 w-48 rounded-lg border border-border/50 bg-white p-2"
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestart}
            disabled={restart.isPending}
            className="flex-1"
          >
            {restart.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Restart
          </Button>
          {!isConnected && !status?.hasQR && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewQR}
              disabled={newQR.isPending}
              className="flex-1"
            >
              {newQR.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <QrCode className="h-3.5 w-3.5" />
              )}
              New QR
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="flex-1 hover:text-destructive hover:border-destructive/50"
          >
            {logout.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Logout
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
