import { useEffect, useState } from "react"
import { useSettings, useUpdateSettings } from "@/hooks/use-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import type { SettingItem } from "@/lib/types"

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const

function findSetting(items: SettingItem[] | undefined, key: string) {
  return items?.find((s) => s.key === key)
}

export function SettingsPage() {
  const { data, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [logLevel, setLogLevel] = useState("info")
  const [autoDownloadMedia, setAutoDownloadMedia] = useState(true)
  const [maxMediaSizeMB, setMaxMediaSizeMB] = useState(100)

  // Sync local state from fetched data
  useEffect(() => {
    if (!data?.data) return
    const items = data.data
    const ll = findSetting(items, "logLevel")
    if (ll) setLogLevel(ll.value as string)
    const adm = findSetting(items, "autoDownloadMedia")
    if (adm) setAutoDownloadMedia(adm.value as boolean)
    const mms = findSetting(items, "maxMediaSizeMB")
    if (mms) setMaxMediaSizeMB(mms.value as number)
  }, [data])

  function handleSave() {
    updateSettings.mutate(
      { logLevel, autoDownloadMedia, maxMediaSizeMB },
      {
        onSuccess: () => toast.success("Settings saved"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  function handleReset(key: string) {
    const setting = findSetting(data?.data, key)
    if (!setting) return
    const defaultVal = setting.defaultValue
    // Reset local state to default
    if (key === "logLevel") setLogLevel(defaultVal as string)
    if (key === "autoDownloadMedia") setAutoDownloadMedia(defaultVal as boolean)
    if (key === "maxMediaSizeMB") setMaxMediaSizeMB(defaultVal as number)
    // Save just this key with default value
    updateSettings.mutate(
      { [key]: defaultVal },
      {
        onSuccess: () => toast.success("Setting reset to default"),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  const isOverridden = (key: string) => findSetting(data?.data, key)?.isOverridden ?? false

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Runtime settings that take effect immediately.
          </p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Runtime settings that take effect immediately.
        </p>
      </div>

      {/* Logging */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Logging</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            label="Log Level"
            description="Controls the verbosity of server logs."
            isOverridden={isOverridden("logLevel")}
            onReset={() => handleReset("logLevel")}
          >
            <Select value={logLevel} onValueChange={setLogLevel}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      {/* Media */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Media</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            label="Auto-Download Media"
            description="Automatically download media from incoming messages."
            isOverridden={isOverridden("autoDownloadMedia")}
            onReset={() => handleReset("autoDownloadMedia")}
          >
            <Switch
              checked={autoDownloadMedia}
              onCheckedChange={setAutoDownloadMedia}
            />
          </SettingRow>

          <div className="h-px bg-border" />

          <SettingRow
            label="Max Media Size (MB)"
            description="Skip media files larger than this. 0 = unlimited."
            isOverridden={isOverridden("maxMediaSizeMB")}
            onReset={() => handleReset("maxMediaSizeMB")}
          >
            <Input
              type="number"
              min={0}
              value={maxMediaSizeMB}
              onChange={(e) => setMaxMediaSizeMB(parseInt(e.target.value, 10) || 0)}
              className="w-24 h-9"
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending && (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  )
}

function SettingRow({
  label,
  description,
  isOverridden,
  onReset,
  children,
}: {
  label: string
  description: string
  isOverridden: boolean
  onReset: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5 flex-1">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-600 border-emerald-200">
            Immediate
          </Badge>
          {isOverridden && (
            <>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Overridden
              </Badge>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onReset}
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                title="Reset to .env default"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
