import { useEffect, useRef, useState } from "react"
import { useProfilePic } from "@/hooks/use-profile-pic"
import { PersonAvatar, GroupAvatar } from "./icons"
import { cn } from "@/lib/utils"

/**
 * Defer avatar fetches until the element is (nearly) on screen — a 400-row
 * chat list must not fire 400 upstream profile-pic requests on mount (the API
 * is rate-limited at 200 req/min, and WhatsApp throttles harder).
 */
function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          obs.disconnect()
        }
      },
      { rootMargin: "300px" }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView])

  return [ref, inView]
}

export function ChatAvatar({
  jid,
  isGroup,
  size = 49,
  className,
}: {
  jid: string
  isGroup?: boolean
  size?: number
  className?: string
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const url = useProfilePic(inView ? jid : undefined)

  return (
    <div
      ref={ref}
      className={cn("shrink-0 overflow-hidden rounded-full bg-wa-avatar", className)}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : isGroup ? (
        <GroupAvatar className="h-full w-full" />
      ) : (
        <PersonAvatar className="h-full w-full" />
      )}
    </div>
  )
}
