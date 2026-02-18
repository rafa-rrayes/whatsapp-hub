import { useMemo } from "react"
import { useContacts, useGroups } from "./use-api"

export function useContactMap() {
  const { data: contactsData } = useContacts()
  const { data: groupsData } = useGroups()

  const map = useMemo(() => {
    const m = new Map<string, string>()
    if (contactsData?.data) {
      for (const c of contactsData.data) {
        const name = c.name || c.notify_name || c.short_name
        if (name) m.set(c.jid, name)
      }
    }
    if (groupsData?.data) {
      for (const g of groupsData.data) {
        if (g.name) m.set(g.jid, g.name)
      }
    }
    return m
  }, [contactsData, groupsData])

  return map
}

export function resolveJid(jid: string, map: Map<string, string>): string {
  if (!jid) return ""
  const name = map.get(jid)
  if (name) return name
  // Fallback: format the JID nicely
  if (jid.endsWith("@g.us")) {
    return jid.replace("@g.us", " (group)")
  }
  if (jid.endsWith("@s.whatsapp.net")) {
    return "+" + jid.replace("@s.whatsapp.net", "")
  }
  if (jid.endsWith("@lid")) {
    return jid.replace("@lid", "")
  }
  return jid
}
