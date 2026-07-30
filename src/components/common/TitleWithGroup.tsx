import type { Group } from '@electron/types'
import { GroupBadge } from './GroupBadge'
import './TitleWithGroup.css'

/**
 * Renders an objective's title next to its group badge on one row. The two share the space via
 * `flex: 1 1 0` + `max-width: max-content` (see the CSS): each grows only up to its real rendered
 * width, so a short field stays whole and yields its slack to the other, and when both are too long
 * they split and both truncate, so the shorter is never truncated because its neighbor is long. This
 * uses the browser's own layout (rendered width, uppercase and all), so no text measuring is needed.
 */
export function TitleWithGroup({ title, group, groups, className }: {
  title: string
  group?: string
  groups: Group[]
  className?: string
}) {
  return (
    <span className={`twg${className ? ' ' + className : ''}`}>
      <span className="twg__title" title={title}>{title}</span>
      {group && <GroupBadge group={group} groups={groups} className="twg__group" />}
    </span>
  )
}
