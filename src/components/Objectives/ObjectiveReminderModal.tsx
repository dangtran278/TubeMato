import { useEffect, useRef } from 'react'
import type { ObjectiveReminderItem } from '@electron/types'
import { useSettingsStore } from '../../store'
import { formatIsoDateDdMmYyyy } from '../../utils/dateDisplay'
import { mascotSrc } from '../../utils/mascot'
import { TitleWithGroup } from '../common/TitleWithGroup'
import './ObjectiveReminderModal.css'

interface Props {
  /** Shared batch-title roast (objectiveReminderBatchTitle). */
  title: string
  items: ObjectiveReminderItem[]
  onClose: () => void
}

function progressPct(completed: number, target: number): number {
  if (target <= 0) return 100
  return Math.min(completed / target, 1) * 100
}

/**
 * The roast already starts with its score ("0/5. …"), which the row also shows as a chip.
 * Drop just that leading prefix so it isn't duplicated; the rest of the sentence stays as
 * written (any "3 check-ins left" mid-sentence is correct; it's this row's objective).
 */
function stripLeadingScore(roast: string): string {
  return roast.replace(/^\d+\/\d+\.\s*/, '')
}

export default function ObjectiveReminderModal({ title, items, onClose }: Props) {
  const { settings } = useSettingsStore()
  // Esc closes (modal convention). Nothing to "save", so Enter is left alone.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close only when a press AND release both land on the backdrop (not a drag out of the modal).
  const downOnBackdrop = useRef(false)

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
        downOnBackdrop.current = false
      }}
    >
      <div className="reminder-modal" role="dialog" aria-label="Objective reminders">
        <div className="reminder-modal__header">
          <img className="reminder-modal__mascot" src={mascotSrc(settings.personality)} alt="" draggable={false} />
          <span className="reminder-modal__title">{title}</span>
        </div>

        <div className="reminder-modal__list">
          {items.map((it, i) => {
            // Calm mode hides the roast and shows the cycle's due date in its place; if a row
            // somehow has no due date, there's no sub-line, so center the scan row instead.
            const calm = settings.personality === 'calm'
            const showDue = calm && !!it.dueDate
            return (
            <div className={`reminder-row reminder-row--${it.severity}`} key={i}>
              <div className="reminder-row__main">
                <div className={`reminder-row__scan${calm && !showDue ? ' reminder-row__scan--compact' : ''}`}>
                  <TitleWithGroup title={it.title} group={it.group} groups={settings.groups} className="reminder-row__name" />
                  <span className="reminder-row__progress">
                    <div className="progress-bar reminder-row__bar">
                      <div
                        className="progress-bar__fill progress-bar__fill--success"
                        style={{ width: `${progressPct(it.completed, it.target)}%` }}
                      />
                    </div>
                    <span className="reminder-row__score">
                      {it.completed}/{it.target}
                    </span>
                  </span>
                </div>
                {calm
                  ? showDue && <div className="reminder-row__due">Due {formatIsoDateDdMmYyyy(it.dueDate!)}</div>
                  : <div className="reminder-row__roast">{stripLeadingScore(it.roast)}</div>}
              </div>
            </div>
            )
          })}
        </div>

        <div className="reminder-modal__footer">
          <button className="btn btn-primary" onClick={onClose}>
            {settings.personality === 'calm' ? 'Close' : "Fine, I'll look"}
          </button>
        </div>
      </div>
    </div>
  )
}
