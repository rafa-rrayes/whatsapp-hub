// Shared chart styling for the Statistics dashboard. Values mirror the dark
// palette already used by the legacy charts so everything stays consistent.

export const CHART = {
  sent: "oklch(0.67 0.17 162)",
  received: "oklch(0.6 0.15 250)",
  accent: "oklch(0.65 0.18 80)",
  grid: "oklch(0.25 0 0)",
  axis: "oklch(0.65 0 0)",
} as const

export const TOOLTIP_STYLE = {
  background: "oklch(0.17 0 0)",
  border: "1px solid oklch(0.3 0 0)",
  borderRadius: "8px",
  fontSize: 12,
  color: "oklch(0.985 0 0)",
} as const

// Categorical palette for type / media / chat breakdowns.
export const PALETTE = [
  "oklch(0.67 0.17 162)",
  "oklch(0.6 0.15 250)",
  "oklch(0.65 0.18 80)",
  "oklch(0.55 0.2 27)",
  "oklch(0.7 0.12 300)",
  "oklch(0.6 0.15 200)",
  "oklch(0.5 0.15 150)",
  "oklch(0.6 0.18 30)",
  "oklch(0.72 0.15 130)",
  "oklch(0.58 0.16 330)",
] as const
