/** Inline pencil/edit icon, matched to TrashIcon's style. Used for rename affordances. */
export function PencilIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}
      fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden="true">
      <path d="M16.85 4.44a1.5 1.5 0 0 1 2.12 0l0.59 0.59a1.5 1.5 0 0 1 0 2.12l-1.06 1.06-2.71-2.71 1.06-1.06zM14.72 6.56l2.71 2.71-7.6 7.6a1 1 0 0 1-.47.26l-3.02.76a.5.5 0 0 1-.61-.61l.76-3.02a1 1 0 0 1 .26-.47l7.6-7.6z" />
    </svg>
  )
}
