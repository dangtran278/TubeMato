// Replaces `‹`/`›`: those are quotation marks whose ink sits off-centre in the em box no matter
// how well the button centres its line box. A drawn path is centred by geometry instead.
const PATHS = {
  left:  'M14.5 5.5 8 12l6.5 6.5',
  right: 'M9.5 5.5 16 12l-6.5 6.5',
  down:  'M5.5 9.5 12 16l6.5-6.5',
  up:    'M5.5 14.5 12 8l6.5 6.5',
} as const

export function ChevronIcon({ dir, size = 16, className }: {
  dir: keyof typeof PATHS
  size?: number
  className?: string
}) {
  // display:block drops the inline baseline gap that nudges the icon upward.
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}
      fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d={PATHS[dir]} />
    </svg>
  )
}
