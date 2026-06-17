import { TickSingle, TickDouble, ClockPending } from "./icons"

export type TickStatus = "pending" | "sent" | "delivered" | "read" | "played"

export function MessageTicks({ status }: { status?: TickStatus }) {
  switch (status) {
    case "pending":
      return <ClockPending className="inline-block h-[15px] w-4 text-wa-text-muted" />
    case "delivered":
      return <TickDouble className="inline-block h-[15px] w-4 text-wa-text-muted" />
    case "read":
    case "played":
      return <TickDouble className="inline-block h-[15px] w-4 text-wa-blue" />
    case "sent":
    default:
      return <TickSingle className="inline-block h-[15px] w-4 text-wa-text-muted" />
  }
}
