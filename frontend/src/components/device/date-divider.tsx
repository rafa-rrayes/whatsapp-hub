import { formatDayDivider } from "./format"

export function DateDivider({ ts }: { ts: number }) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-[7.5px] bg-wa-hover-deep px-3 py-1.5 text-[12.5px] uppercase text-wa-text-muted shadow-sm">
        {formatDayDivider(ts)}
      </span>
    </div>
  )
}

export function UnreadDivider() {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-[7.5px] bg-wa-hover-deep px-3 py-1.5 text-[12.5px] uppercase text-wa-text-muted shadow-sm">
        Unread messages
      </span>
    </div>
  )
}
