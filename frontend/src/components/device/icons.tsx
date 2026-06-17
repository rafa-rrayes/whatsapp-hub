// WhatsApp's own glyphs (ticks, tails, send, default avatar) — exact paths,
// not available in lucide.

export function TickSingle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 15" width="16" height="15" className={className} fill="currentColor">
      <path d="M10.91 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z" />
    </svg>
  )
}

export function TickDouble({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 15" width="16" height="15" className={className} fill="currentColor">
      <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z" />
    </svg>
  )
}

export function ClockPending({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 15" width="16" height="15" className={className} fill="currentColor">
      <path d="M9.75 7.713H8.244V5.359a.5.5 0 0 0-.5-.5H7.65a.5.5 0 0 0-.5.5v2.947a.5.5 0 0 0 .5.5h2.1a.5.5 0 0 0 .5-.5v-.093a.5.5 0 0 0-.5-.5zM7.994 2.905a4.658 4.658 0 1 0 0 9.316 4.658 4.658 0 0 0 0-9.316zm0 8.816a4.158 4.158 0 1 1 0-8.316 4.158 4.158 0 0 1 0 8.316z" />
    </svg>
  )
}

export function TailOut({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 13" width="8" height="13" className={className}>
      <path opacity="0.13" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" fill="#0b141a" />
      <path d="M5.188 0H0v11.193l6.467-8.625C7.526 1.156 6.958 0 5.188 0z" fill="currentColor" />
    </svg>
  )
}

export function TailIn({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 13" width="8" height="13" className={className}>
      <path opacity="0.13" d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" fill="#0b141a" />
      <path d="M1.533 2.568L8 11.193V0H2.812C1.042 0 .474 1.156 1.533 2.568z" fill="currentColor" />
    </svg>
  )
}

export function SendGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" className={className} fill="currentColor">
      <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
    </svg>
  )
}

export function PersonAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 212 212" className={className}>
      <path fill="#6a7175" d="M106 0a106 106 0 1 0 0 212 106 106 0 0 0 0-212z" />
      <path
        fill="#dfe5e7"
        d="M173.6 171.4a106.3 106.3 0 0 1-135.2 0c4.6-12.7 15.6-23.1 31.4-29.4 5.2-2.1 9.3-6.3 13.4-10.5-6.4-5.7-11.3-13.8-14-23.1-2.9-1.9-5-6-5.4-10.9-.4-4.5.7-8.6 2.8-11.3-.6-3.4-1-7-1-10.7 0-22 15.4-39.8 34.4-39.8s34.4 17.8 34.4 39.8c0 3.7-.4 7.3-1 10.7 2.1 2.7 3.2 6.8 2.8 11.3-.4 4.9-2.5 9-5.4 10.9-2.7 9.3-7.6 17.4-14 23.1 4.1 4.2 8.2 8.4 13.4 10.5 15.8 6.3 26.8 16.7 31.4 29.4z"
      />
    </svg>
  )
}

export function GroupAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 212 212" className={className}>
      <path fill="#6a7175" d="M106 0a106 106 0 1 0 0 212 106 106 0 0 0 0-212z" />
      <g fill="#dfe5e7">
        <path d="M141 73.4c0 16.9-11 30.6-24.6 30.6s-24.6-13.7-24.6-30.6S102.8 46 116.4 46 141 56.5 141 73.4z" transform="translate(-38 14)" />
        <path d="M163.3 158.8c-4-10.9-13.5-19.8-27.1-25.2-4.5-1.8-8-5.4-11.5-9 -5.5 4.9-11.9 7.7-18.7 7.7s-13.2-2.8-18.7-7.7c-3.5 3.6-7 7.2-11.5 9-13.6 5.4-23.1 14.3-27.1 25.2a106.4 106.4 0 0 0 114.6 0z" transform="translate(-38 14)" />
        <path d="M141 73.4c0 16.9-11 30.6-24.6 30.6s-24.6-13.7-24.6-30.6S102.8 46 116.4 46 141 56.5 141 73.4z" transform="translate(38 14)" opacity="0.85" />
      </g>
    </svg>
  )
}
