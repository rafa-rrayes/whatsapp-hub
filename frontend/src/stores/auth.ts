import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

interface AuthState {
  apiKey: string
  isAuthenticated: boolean
  setApiKey: (key: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      apiKey: "",
      isAuthenticated: false,
      setApiKey: (key: string) => set({ apiKey: key, isAuthenticated: true }),
      logout: () => set({ apiKey: "", isAuthenticated: false }),
    }),
    {
      name: "whatsapp-hub-auth",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
