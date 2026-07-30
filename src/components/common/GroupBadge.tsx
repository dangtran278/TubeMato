import type { CSSProperties } from 'react'
import type { Group } from '@electron/types'
import { colorForGroupName } from '../../utils/groupDisplay'
import './GroupBadge.css'

/**
 * The group tag as a colored badge (dot + name), reused wherever an objective is shown by title so
 * the group reads at a glance instead of as a "(Group)" text suffix. No tooltip: the name is
 * already visible, so hovering shouldn't surface a redundant one. The name truncates when the badge
 * is width-constrained (e.g. sharing a row with a long title).
 */
export function GroupBadge({ group, groups, className, style }: {
  group?: string
  groups: Group[]
  className?: string
  style?: CSSProperties
}) {
  if (!group) return null
  const s = { '--group-color': colorForGroupName(groups, group), ...style } as CSSProperties
  return (
    <span className={`badge badge-group${className ? ' ' + className : ''}`} style={s}>
      <span className="badge-group__dot" />
      <span className="badge-group__name">{group}</span>
    </span>
  )
}
