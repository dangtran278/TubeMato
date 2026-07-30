/** Inline trash-can icon, drawn as a filled silhouette (fill = currentColor) rather than a thin
 *  outline or the platform emoji, which renders inconsistently. `display:block` avoids the
 *  inline-baseline gap that otherwise pushes it toward the top of a non-flex button. */
export function TrashIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}
      fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden="true">
      {/* lid handle + rim */}
      <path d="M10.5 4.5a1 1 0 0 0-1 1V6.5h5V5.5a1 1 0 0 0-1-1h-3zM5.5 6.5a1 1 0 1 0 0 2h13a1 1 0 1 0 0-2h-13z" />
      {/* wider can body with three rib cut-outs whose width equals the two gaps between them
          (span 8.85→15.15 split into 5 equal 1.26-wide segments: rib, gap, rib, gap, rib) */}
      <path d="M6.8 9.3l.75 10.4a2 2 0 0 0 2 1.85h4.9a2 2 0 0 0 2-1.85L17.2 9.3H6.8zM8.85 11.4H10.11V17.9H8.85zM11.37 11.4H12.63V17.9H11.37zM13.89 11.4H15.15V17.9H13.89z" />
    </svg>
  )
}
