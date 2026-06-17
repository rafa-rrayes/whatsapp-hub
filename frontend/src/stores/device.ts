import { create } from "zustand"
import type { Message } from "@/lib/types"

export interface PresenceInfo {
  /** Baileys presence: available | unavailable | composing | recording | paused */
  status?: string
  lastSeen?: number
  /** For groups: jid of the participant currently typing/recording. */
  participant?: string
  updatedAt: number
}

export type FilterTab = "all" | "unread" | "favourites" | "groups"

interface LightboxState {
  mediaId: string
  mimeType?: string
  filename?: string
}

interface DeviceState {
  replyTo: Message | null
  infoPanelOpen: boolean
  filterTab: FilterTab
  searchQuery: string
  archivedView: boolean
  presence: Record<string, PresenceInfo>
  lightbox: LightboxState | null

  setReplyTo: (m: Message | null) => void
  setInfoPanelOpen: (open: boolean) => void
  setFilterTab: (tab: FilterTab) => void
  setSearchQuery: (q: string) => void
  setArchivedView: (v: boolean) => void
  setPresence: (jid: string, info: Omit<PresenceInfo, "updatedAt">) => void
  openLightbox: (state: LightboxState) => void
  closeLightbox: () => void
  /** Reset per-chat UI state when switching chats. */
  resetChatState: () => void
}

export const useDeviceStore = create<DeviceState>((set) => ({
  replyTo: null,
  infoPanelOpen: false,
  filterTab: "all",
  searchQuery: "",
  archivedView: false,
  presence: {},
  lightbox: null,

  setReplyTo: (replyTo) => set({ replyTo }),
  setInfoPanelOpen: (infoPanelOpen) => set({ infoPanelOpen }),
  setFilterTab: (filterTab) => set({ filterTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setArchivedView: (archivedView) => set({ archivedView }),
  setPresence: (jid, info) =>
    set((s) => ({ presence: { ...s.presence, [jid]: { ...info, updatedAt: Date.now() } } })),
  openLightbox: (lightbox) => set({ lightbox }),
  closeLightbox: () => set({ lightbox: null }),
  resetChatState: () => set({ replyTo: null, infoPanelOpen: false }),
}))
