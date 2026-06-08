import { cn } from "@/lib/utils"

interface ProgressProps {
  /** Fill percentage 0–100. Ignored when `indeterminate` is set. */
  value?: number
  /** Render an animated, value-less bar (e.g. a chat awaiting its messages). */
  indeterminate?: boolean
  className?: string
}

/**
 * Minimal, dependency-free progress bar styled to match the shadcn tokens used
 * across the dashboard. Avoids pulling in @radix-ui/react-progress and gives us
 * an `indeterminate` state for pending rows.
 */
export function Progress({ value = 0, indeterminate = false, className }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {indeterminate ? (
        <div className="absolute inset-y-0 left-0 w-2/5 animate-pulse rounded-full bg-muted-foreground/40" />
      ) : (
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}
