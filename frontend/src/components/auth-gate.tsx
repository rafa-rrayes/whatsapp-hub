import { useState } from "react"
import { useAuthStore } from "@/stores/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageSquare, Loader2, AlertCircle } from "lucide-react"

export function AuthGate() {
  const [key, setKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const setApiKey = useAuthStore((s) => s.setApiKey)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!key.trim()) return

    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/connection/status", {
        headers: { "x-api-key": key.trim() },
      })
      if (!res.ok) {
        throw new Error("Invalid API key")
      }
      setApiKey(key.trim())
    } catch {
      setError("Invalid API key. Please check and try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">WhatsApp Hub</CardTitle>
          <CardDescription>Enter your API key to access the dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="API Key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
                className="h-11"
              />
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
            </div>
            <Button type="submit" className="w-full h-11" disabled={loading || !key.trim()}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
