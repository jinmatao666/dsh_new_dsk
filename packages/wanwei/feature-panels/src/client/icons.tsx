/** Shared add-action artwork; no business registration. */
export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Lucide Coins (ISC); original artwork from https://github.com/lucide-icons/lucide/blob/main/icons/coins.svg. */
export function CreditCoinIcon({ className }: { className?: string }) {
  return <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d99a22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" />
    <path d="M15 6h1v4" />
    <path d="m6.134 14.768.866-.5 2 3.464" />
    <circle cx="16" cy="8" r="6" />
  </svg>
}
