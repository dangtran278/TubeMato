import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuid } from 'uuid'
import { useFiveYearStore, useSettingsStore, useUiStore } from '../../store'
import { GroupInput, GroupSwatch } from '../Objectives/ObjectivesView'
import { GroupBadge } from '../common/GroupBadge'
import { CenterSelect } from '../common/CenterSelect'
import { Tooltip } from '../common/Tooltip'
import { TrashIcon } from '../common/TrashIcon'
import { ChevronIcon } from '../common/ChevronIcon'
import { PencilIcon } from '../common/PencilIcon'
import { ensureGroupRegistered, setGroupColor, pickColorForNewGroup } from '../../utils/groupDisplay'
import { planYears, overallProgress, usedCategories, yearItems, placeGoal, placeCategoryBlock } from '@electron/fiveYearPlan'
import type { CategoryItem, YearItem } from '@electron/fiveYearPlan'
import { calendarDateKey, resolveTimeZone } from '@electron/calendarDate'
import { fiveYearSubtitle } from '@electron/personalityCopy'
import {
  FIVE_YEAR_PICKER_SPAN,
  FIVE_YEAR_CATEGORY_MAX_LENGTH,
  FIVE_YEAR_ACTION_MAX_LENGTH,
  OBJECTIVE_TITLE_MAX_LENGTH,
} from '@electron/types'
import type { FiveYearGoal } from '@electron/types'
import './FiveYear.css'

/* ── goal form (create / edit) ────────────────────────────────────────────── */

/** Drag dots for an action row. Drawn rather than typed (⠿) so the width is exactly 6px and fits
 *  inside the input's 16px left padding without crowding the text. */
function GripIcon() {
  return (
    <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" aria-hidden="true">
      <circle cx="1" cy="1" r="1" /><circle cx="5" cy="1" r="1" />
      <circle cx="1" cy="5" r="1" /><circle cx="5" cy="5" r="1" />
      <circle cx="1" cy="9" r="1" /><circle cx="5" cy="9" r="1" />
    </svg>
  )
}

/** One row of the Actions editor. The grip, not the row, is the drag source, so text selection
 *  inside the input keeps working. The trailing blank row is the "add another" affordance: it has
 *  neither control and is not a drop target. */
function ActionRow({ value, blank, line, dragging, onChange, onRemove, onDragStart, onDragEnd, onDragOver, onDrop }: {
  value: string
  blank: boolean
  line: 'top' | 'bottom' | null
  dragging: boolean
  onChange: (v: string) => void
  onRemove: () => void
  onDragStart: (e: DragEvent, row: HTMLElement | null) => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const cls = `goal-form__action${dragging ? ' goal-form__action--dragging' : ''}${line ? ` fy-line-${line}` : ''}`
  return (
    <div ref={rowRef} className={cls}
      onDragOver={blank ? undefined : onDragOver} onDrop={blank ? undefined : onDrop}>
      {!blank && (
        <span className="goal-form__action-grip" aria-hidden="true" draggable
          onDragStart={e => onDragStart(e, rowRef.current)} onDragEnd={onDragEnd}><GripIcon /></span>
      )}
      <input className="input" value={value} maxLength={FIVE_YEAR_ACTION_MAX_LENGTH}
        placeholder="A concrete next step…" onChange={e => onChange(e.target.value)} />
      {!blank && (
        <button type="button" className="btn-icon goal-form__action-rm" aria-label="Remove action"
          onClick={onRemove}>✕</button>
      )}
    </div>
  )
}

function GoalForm({ initial, defaultYear, defaultCategory, currentYear, keysPaused, onSave, onDelete, onClose }: {
  initial?: FiveYearGoal
  defaultYear: number
  defaultCategory?: string
  currentYear: number
  /** Set while the delete confirm is stacked on top, since both listen for Esc/Enter on `document`. */
  keysPaused?: boolean
  onSave: (g: FiveYearGoal) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const { settings, setSettings } = useSettingsStore()
  const categories = settings.fiveYearCategories
  const [title, setTitle] = useState(initial?.title ?? '')
  const [category, setCategory] = useState(initial?.category ?? defaultCategory ?? '')
  const [year, setYear] = useState(initial?.targetYear ?? defaultYear)
  // Actions edited as a growable list of text rows; a trailing blank row is the "add another" affordance.
  const [actions, setActions] = useState<string[]>(() => [...(initial?.actions ?? []), ''])
  const [note, setNote] = useState(initial?.note ?? '')
  const [err, setErr] = useState<string | null>(null)

  // Category color preview + staging, identical to the objective Group field: an unregistered name
  // gets one stable random palette color (held in the ref so it doesn't flicker per keystroke); a
  // registered name owns its stored color; an explicit swatch pick overrides via `manualColor`.
  const [manualColor, setManualColor] = useState<string | null>(null)
  const pendingColorRef = useRef<string | null>(null)
  const trimmedCat = category.trim()
  const registered = categories.find(c => c.name.toLowerCase() === trimmedCat.toLowerCase())
  let previewColor: string
  if (manualColor) {
    previewColor = manualColor
  } else if (!trimmedCat || registered) {
    pendingColorRef.current = null
    previewColor = registered?.color ?? ''
  } else {
    if (pendingColorRef.current === null) pendingColorRef.current = pickColorForNewGroup(categories)
    previewColor = pendingColorRef.current
  }
  const changeCategory = (v: string) => { setCategory(v); setManualColor(null); setErr(null) }

  // Defer reminder / summary popups while this form is open.
  useEffect(() => {
    useUiStore.getState().openEditor()
    return () => useUiStore.getState().closeEditor()
  }, [])

  // Year picker: the next `FIVE_YEAR_PICKER_SPAN` years, plus the clicked column's year and the
  // goal's own year if either falls outside that window (so editing never loses the value).
  const yearOptions = useMemo(() => {
    const set = new Set<number>()
    for (let i = 0; i < FIVE_YEAR_PICKER_SPAN; i++) set.add(currentYear + i)
    set.add(defaultYear)
    if (initial) set.add(initial.targetYear)
    return [...set].sort((a, b) => a - b)
  }, [currentYear, defaultYear, initial])

  const setActionAt = (i: number, v: string) => setActions(prev => {
    const next = [...prev]
    next[i] = v
    // Keep exactly one trailing blank row available to type the next action into.
    while (next.length && next[next.length - 1].trim() === '') next.pop()
    next.push('')
    return next
  })
  const removeActionAt = (i: number) => setActions(prev => {
    const next = prev.filter((_, idx) => idx !== i)
    if (!next.length || next[next.length - 1].trim() !== '') next.push('')
    return next
  })

  // Action reordering. `dropSlot` is an insertion slot, not a row: slot N means "before row N", so
  // the last real row's bottom half is slot `realActions` and the trailing blank stays last.
  const realActions = actions.length - 1
  const [dragAction, setDragAction] = useState<number | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const actionDragStart = (e: DragEvent, i: number, row: HTMLElement | null) => {
    setDragAction(i)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i)) // Firefox refuses to start a drag without payload
    if (row) e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2)
  }
  const actionDragOver = (e: DragEvent, i: number) => {
    if (dragAction === null) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const slot = e.clientY - r.top > r.height / 2 ? i + 1 : i
    setDropSlot(prev => (prev === slot ? prev : slot))
  }
  const endActionDrag = () => { setDragAction(null); setDropSlot(null) }
  const actionDrop = (e: DragEvent) => {
    e.preventDefault()
    const from = dragAction, to = dropSlot
    endActionDrag()
    // Both no-op slots (its own edges) leave the order alone.
    if (from === null || to === null || to === from || to === from + 1) return
    setActions(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to > from ? to - 1 : to, 0, moved)
      return next
    })
  }
  // Where to draw the insertion line, suppressed while the slot is one the drop would ignore.
  const actionLine = (i: number): 'top' | 'bottom' | null => {
    if (dragAction === null || dropSlot === null) return null
    if (dropSlot === dragAction || dropSlot === dragAction + 1) return null
    if (dropSlot === realActions) return i === realActions - 1 ? 'bottom' : null
    return dropSlot === i ? 'top' : null
  }

  async function save() {
    const t = title.trim()
    if (!t) { setErr('Give the goal a title.'); return }

    const trimmedCategory = trimmedCat.slice(0, FIVE_YEAR_CATEGORY_MAX_LENGTH)
    if (trimmedCategory) {
      // Register a new category (with the previewed color) or apply a staged color change to an
      // existing one. Only written on Save; Cancel never reaches here.
      let next = ensureGroupRegistered(categories, trimmedCategory, previewColor)
      if (manualColor) next = setGroupColor(next, trimmedCategory, manualColor)
      if (next !== categories) {
        await window.tubemato.settings.set({ fiveYearCategories: next })
        setSettings({ ...settings, fiveYearCategories: next })
      }
    }

    const cleanActions = actions.map(a => a.trim().slice(0, FIVE_YEAR_ACTION_MAX_LENGTH)).filter(Boolean)
    const goal: FiveYearGoal = {
      id: initial?.id ?? uuid(),
      title: t.slice(0, OBJECTIVE_TITLE_MAX_LENGTH),
      category: trimmedCategory || undefined,
      targetYear: year,
      actions: cleanActions,
      note: note.trim() || undefined,
      done: initial?.done ?? false,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    }
    onSave(goal)
    onClose()
  }

  // Esc = Cancel, Enter = Save (buttons/textarea keep their own Enter behavior).
  const handlers = useRef({ save, onClose, keysPaused })
  useEffect(() => { handlers.current = { save, onClose, keysPaused } })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handlers.current.keysPaused) return
      if (e.key === 'Escape') { e.preventDefault(); handlers.current.onClose() }
      else if (e.key === 'Enter') {
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'TEXTAREA')) return
        e.preventDefault(); void handlers.current.save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close only when a press and release both land on the backdrop (a drag from inside must not close).
  const downOnBackdrop = useRef(false)
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); downOnBackdrop.current = false }}
    >
      <div className="modal modal--goal">
        <div className="modal__header">
          <span className="modal__title">{initial ? 'Edit goal' : 'New goal'}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="goal-form__field">
            <label className="form-label">Title <span className="form-required">*</span></label>
            <input className="input" value={title} maxLength={OBJECTIVE_TITLE_MAX_LENGTH}
              onChange={e => { setErr(null); setTitle(e.target.value) }} autoFocus />
          </div>
          <div className="goal-form__row">
            <div className="goal-form__field goal-form__field--year">
              <label className="form-label">Target year</label>
              <CenterSelect className="goal-form__year-select" ariaLabel="Target year" value={String(year)}
                onChange={v => setYear(Number(v))}
                options={yearOptions.map(y => ({ value: String(y), label: String(y) }))} />
            </div>
            <div className="goal-form__field">
              <label className="form-label">Category</label>
              <div className="goal-form__category-row">
                <GroupInput value={category} onChange={changeCategory} groups={categories} />
                {category.trim() && <GroupSwatch color={previewColor} onPick={c => { setManualColor(c); setErr(null) }} />}
              </div>
            </div>
          </div>
          <div className="goal-form__field">
            <label className="form-label">Actions</label>
            <div className="goal-form__actions">
              {actions.map((a, i) => (
                <ActionRow key={i} value={a} blank={i === realActions}
                  line={actionLine(i)} dragging={dragAction === i}
                  onChange={v => setActionAt(i, v)} onRemove={() => removeActionAt(i)}
                  onDragStart={(e, row) => actionDragStart(e, i, row)} onDragEnd={endActionDrag}
                  onDragOver={e => actionDragOver(e, i)} onDrop={actionDrop} />
              ))}
            </div>
          </div>
          <div className="goal-form__field">
            <label className="form-label">Note</label>
            <textarea className="input goal-form__note" value={note} rows={2}
              placeholder="Motivation, context, or a rough plan."
              onChange={e => setNote(e.target.value)} />
          </div>
        </div>
        <div className="modal__footer goal-form__footer">
          {/* Only asks; the parent closes this form once its confirm is accepted. */}
          {onDelete && <button className="btn btn-ghost goal-form__delete" onClick={onDelete}>Delete</button>}
          {err && <span className="goal-form__error">{err}</span>}
          <div className="goal-form__footer-right">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── goal + card rendering (drag-and-drop) ──────────────────────────────────── */

// Visual drag feedback: an insertion LINE around an item (for reorder / place-between), an INTO
// highlight on a category card (goal will adopt that category), a column highlight, or trash.
export type Hint =
  | { kind: 'line'; key: string; edge: 'top' | 'bottom' }
  | { kind: 'into'; key: string }
  | { kind: 'col'; year: number }
  | { kind: 'trash' }
  | { kind: 'rename' }

// Handlers threaded from the board so cards/rows are plain presentational drag sources + drop zones.
// `topIds`/`idx` give a top-level item its sibling order; `cardIds`/`idx` a row its order within a card.
interface Dnd {
  hint: Hint | null
  goalDragStart: (e: DragEvent, goal: FiveYearGoal) => void
  catDragStart: (e: DragEvent, category: string, year: number) => void
  dragEnd: () => void
  commit: (e: DragEvent) => void
  // A goal over a row → insert within that card (orange line). A goal over a card's general area →
  // INTO that category (highlight). Everything at the top level (reordering cards, placing a goal
  // between items, moving to a year) is owned by the column so the gaps between cards aren't dead zones.
  overRow: (goal: FiveYearGoal, cardCategory: string, year: number, cardIds: string[], idx: number) => (e: DragEvent) => void
  overCatCard: (item: CategoryItem, year: number) => (e: DragEvent) => void
  overColumn: (year: number, items: YearItem[], topIds: string[]) => (e: DragEvent) => void
}

const lineClass = (hint: Hint | null, key: string) =>
  hint?.kind === 'line' && hint.key === key ? ` fy-line-${hint.edge}` : ''

// Cheap structural compare for the drag hint (avoids JSON.stringify on every dragover event).
const hintEq = (a: Hint | null, b: Hint | null): boolean => {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'line' && b.kind === 'line') return a.key === b.key && a.edge === b.edge
  if (a.kind === 'into' && b.kind === 'into') return a.key === b.key
  if (a.kind === 'col' && b.kind === 'col') return a.year === b.year
  return a.kind === b.kind // both 'trash' or both 'rename'
}

// The element key of a top-level item (matches CategoryCard's key / a loose card's goal id), so the
// column can point an insertion line at the right item.
const topItemKey = (it: YearItem, year: number) =>
  it.kind === 'category' ? `cat:${year}:${it.category.toLowerCase()}` : it.goal.id

interface GoalActions {
  expanded: boolean
  onToggleDone: () => void
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: () => void
}

// The shared inner content of a goal (checkbox · title · edit/delete · expandable detail), used both
// as a row inside a category card and as a standalone loose card.
function GoalContent({ goal, groups, showBadge, expanded, onToggleDone, onToggleExpand, onEdit, onDelete }:
  { goal: FiveYearGoal; groups: { name: string; color: string }[]; showBadge: boolean } & GoalActions) {
  const hasDetail = goal.actions.length > 0 || !!goal.note
  return (
    <>
      <div className="fycard__top">
        <button type="button" className={`fycard__check${goal.done ? ' fycard__check--on' : ''}`}
          role="checkbox" aria-checked={goal.done} aria-label={goal.done ? 'Mark not done' : 'Mark done'}
          onClick={onToggleDone}>{goal.done ? '✓' : ''}</button>
        <div className="fycard__main">
          {showBadge && goal.category && <GroupBadge group={goal.category} groups={groups} className="fycard__badge" />}
          <span className="fycard__title">{goal.title}</span>
        </div>
        <div className="fycard__tools">
          <Tooltip label="Edit goal">
            <button type="button" className="btn-icon fycard__tool fycard__tool--edit" aria-label="Edit goal" onClick={onEdit}>✎</button>
          </Tooltip>
          <Tooltip label="Delete goal">
            <button type="button" className="btn-icon fycard__tool fycard__tool--del" aria-label="Delete goal" onClick={onDelete}><TrashIcon /></button>
          </Tooltip>
        </div>
      </div>
      {hasDetail && (
        <button type="button" className="fycard__expand" aria-expanded={expanded} onClick={onToggleExpand}>
          <ChevronIcon dir={expanded ? 'down' : 'right'} size={11} />
          {goal.actions.length > 0 ? `${goal.actions.length} action${goal.actions.length > 1 ? 's' : ''}` : 'Note'}
        </button>
      )}
      {hasDetail && expanded && (
        <div className="fycard__detail">
          {goal.actions.length > 0 && (
            <ul className="fycard__actions">{goal.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          )}
          {goal.note && <p className="fycard__note">{goal.note}</p>}
        </div>
      )}
    </>
  )
}

// One goal inside a category card: a drag source, and a drop zone. A dropped goal inserts at this
// row's edge (adopting the card's category); a dragged category bubbles up to the card (not handled here).
function GoalRow({ goal, groups, dnd, cardCategory, year, cardIds, idx, ...actions }:
  { goal: FiveYearGoal; groups: { name: string; color: string }[]; dnd: Dnd; cardCategory: string; year: number; cardIds: string[]; idx: number } & GoalActions) {
  return (
    <div className={`fyrow${goal.done ? ' fyrow--done' : ''}${lineClass(dnd.hint, goal.id)}`}
      draggable onDragStart={e => dnd.goalDragStart(e, goal)} onDragEnd={dnd.dragEnd}
      onDragOver={dnd.overRow(goal, cardCategory, year, cardIds, idx)} onDrop={dnd.commit}>
      <GoalContent goal={goal} groups={groups} showBadge={false} {...actions} />
    </div>
  )
}

// A standalone uncategorized goal. Its positioning is owned by the column; it just needs to be a
// drag source and carry data-fyitem so the column can measure it.
function LooseCard({ goal, groups, dnd, ...actions }:
  { goal: FiveYearGoal; groups: { name: string; color: string }[]; dnd: Dnd } & GoalActions) {
  return (
    <div className={`fycard fycard--loose${goal.done ? ' fycard--done' : ''}${lineClass(dnd.hint, goal.id)}`} data-fyitem=""
      draggable onDragStart={e => dnd.goalDragStart(e, goal)} onDragEnd={dnd.dragEnd}>
      <GoalContent goal={goal} groups={groups} showBadge={false} {...actions} />
    </div>
  )
}

// A category card: a draggable header (move/merge the whole card) over a body of goal rows, and a
// drop zone (a dropped goal joins this category; a dropped category reorders/merges at its edge).
// When every goal is done the card dims and collapses to its header (still expandable).
function CategoryCard({ item, year, groups, dnd, expandedKeys, collapsed, onToggleCollapse, onAdd, goalActions }: {
  item: CategoryItem
  year: number
  groups: { name: string; color: string }[]
  dnd: Dnd
  expandedKeys: Set<string>
  collapsed: boolean
  onToggleCollapse: () => void
  onAdd: () => void
  goalActions: (g: FiveYearGoal) => GoalActions
}) {
  const color = groups.find(c => c.name.toLowerCase() === item.category.toLowerCase())?.color
  const key = `cat:${year}:${item.category.toLowerCase()}`
  const doneCount = item.goals.filter(g => g.done).length
  const cardIds = item.goals.map(g => g.id)
  const cls = `fycatcard${item.allDone ? ' fycatcard--done' : ''}${dnd.hint?.kind === 'into' && dnd.hint.key === key ? ' fy-into' : ''}${lineClass(dnd.hint, key)}`
  return (
    <div className={cls} data-fyitem=""
      style={color ? { '--cat-color': color } as CSSProperties : undefined}
      onDragOver={dnd.overCatCard(item, year)} onDrop={dnd.commit}>
      <div className="fycatcard__head" draggable onDragStart={e => dnd.catDragStart(e, item.category, year)} onDragEnd={dnd.dragEnd}>
        <span className="fycatcard__grip" aria-hidden="true" title="Drag to reorder or move to another year">⠿</span>
        <span className="fycatcard__dot" style={{ background: color }} />
        <span className="fycatcard__name">{item.category}</span>
        <span className="fycatcard__count">{doneCount}/{item.goals.length}</span>
        {item.allDone && (
          <button type="button" className="fycatcard__collapse" aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand category' : 'Collapse category'} onClick={onToggleCollapse}>
            <ChevronIcon dir={collapsed ? 'right' : 'down'} size={13} />
          </button>
        )}
        <Tooltip label="Add a goal to this category">
          <button type="button" className="fycatcard__add" aria-label="Add a goal to this category" onClick={onAdd}><span aria-hidden="true">+</span></button>
        </Tooltip>
      </div>
      {!collapsed && (
        <div className="fycatcard__body">
          {item.goals.map((g, i) => (
            <GoalRow key={g.id} goal={g} groups={groups} dnd={dnd}
              cardCategory={item.category} year={year} cardIds={cardIds} idx={i}
              {...goalActions(g)} expanded={expandedKeys.has(g.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── goal delete confirmation ─────────────────────────────────────────────── */

/** Shared by all three delete paths (card tool, edit-form button, trash drop). Portaled, reuses
 *  the shared .group-delete-* styling. */
function GoalDeleteDialog({ goal, onCancel, onConfirm }: {
  goal: FiveYearGoal
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const count = goal.actions.length
  const parts = [
    count > 0 ? (count === 1 ? 'its 1 action' : `its ${count} actions`) : '',
    goal.note ? 'note' : '',
  ].filter(Boolean)
  const detail = parts.length ? `, along with ${parts.join(' and ')}` : ''
  return createPortal(
    <div className="group-delete-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Delete “{goal.title}”?</div>
        <p className="group-delete-modal__body">
          This goal will be deleted{detail}. This action cannot be undone.
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-danger" onClick={onConfirm}>Delete goal</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── category delete confirmation ─────────────────────────────────────────── */

/** First step of a category-card trash drop: choose whether to remove the category from just the
 *  dragged year, or from every year. (A category can span multiple year columns, so the scope
 *  matters even before the keep/delete-goals choice.) Portaled, reuses the .group-delete-* styling. */
function CategoryScopeDialog({ name, year, onCancel, onPick }: {
  name: string
  year: number
  onCancel: () => void
  onPick: (scope: 'year' | 'all') => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(
    <div className="group-delete-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Delete “{name}”?</div>
        <p className="group-delete-modal__body">
          Choose whether to remove this category from {year} only, or from every year.
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-keep" onClick={() => onPick('year')}>This year ({year})</button>
          <button className="btn group-delete-danger" onClick={() => onPick('all')}>All years</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Second step: given the chosen scope, offer to keep the goals in scope (they just lose the tag) or
 *  delete them too, mirroring the objective group-delete dialog. `year` set = this-year scope; undefined
 *  = all-years. Portaled above the board, reuses the shared .group-delete-* styling. */
function CategoryDeleteDialog({ name, year, goalCount, onCancel, onConfirm }: {
  name: string
  year?: number
  goalCount: number
  onCancel: () => void
  onConfirm: (alsoGoals: boolean) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const scope = year !== undefined ? ` in ${year}` : ''
  const label = goalCount === 1 ? '1 goal' : `${goalCount} goals`
  return createPortal(
    <div className="group-delete-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Delete “{name}”{scope}?</div>
        <p className="group-delete-modal__body">
          {goalCount > 0
            ? <>{label}{scope} use this category. Remove the category from them, or delete them along with it. This action cannot be undone.</>
            : <>No goals use this category{scope}. This action cannot be undone.</>}
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          {goalCount > 0 && <button className="btn group-delete-keep" onClick={() => onConfirm(false)}>Uncategorize goals</button>}
          <button className="btn group-delete-danger" onClick={() => onConfirm(true)}>
            {goalCount > 0 ? 'Delete goals' : 'Delete category'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Rename a category. Collision (merge) handling happens in the parent once a name is submitted. */
function CategoryRenameDialog({ name, onCancel, onSubmit }: {
  name: string
  onCancel: () => void
  onSubmit: (newName: string) => void
}) {
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.select() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const trimmed = value.trim()
  const submit = () => { if (trimmed) onSubmit(trimmed) }
  const downOnBackdrop = useRef(false)
  return createPortal(
    <div className="group-delete-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Rename category “{name}”</div>
        <input
          ref={inputRef}
          className="input group-rename-input"
          maxLength={FIVE_YEAR_CATEGORY_MAX_LENGTH}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-keep" disabled={!trimmed} onClick={submit}>Rename</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Confirm merging one category into another (across all years) that already owns the target name. */
function CategoryMergeDialog({ from, to, goalCount, onCancel, onConfirm }: {
  from: string
  to: string
  goalCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const label = goalCount === 1 ? '1 goal' : `${goalCount} goals`
  return createPortal(
    <div className="group-delete-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Merge into “{to}”?</div>
        <p className="group-delete-modal__body">
          A category named “{to}” already exists. {label} from “{from}” will move into it, and “{from}” will be removed. This action cannot be undone.
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-keep" onClick={onConfirm}>Merge</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── board ────────────────────────────────────────────────────────────────── */

export default function FiveYearView() {
  const { goals, saveGoal, removeGoal, setGoals } = useFiveYearStore()
  const { settings, setSettings } = useSettingsStore()
  const categories = settings.fiveYearCategories
  const todayKey = calendarDateKey(new Date(), resolveTimeZone(settings.calendarTimeZone))
  const currentYear = Number(todayKey.slice(0, 4))
  const years = useMemo(() => planYears(goals, currentYear), [goals, currentYear])
  const progress = overallProgress(goals)

  const [editing, setEditing] = useState<{ goal?: FiveYearGoal; year: number; category?: string } | null>(null)
  // Keys of expanded goals (by id) AND expanded done-category cards (`cat:{year}:{name}`), one set.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Persist a reordered/retagged goals array (drag ops), adopting the store's canonical result.
  const applyGoals = async (next: FiveYearGoal[]) => { if (next !== goals) setGoals(await window.tubemato.fiveYear.set(next)) }

  // ── drag-and-drop wiring (native HTML5) ──────────────────────────────────────
  //  The live payload and the resolved drop action live in refs (dataTransfer content isn't readable
  //  during dragover); `hint` only drives the visual (insertion line / into-highlight / column / trash).
  //  Rules: a goal KEEPS its category on every move; it only CHANGES when dropped onto/into a category
  //  card (adopts that card's category). Year = the destination column. Positioning is by the pointer's
  //  half over an item (before/after). Category cards reorder/merge at the top level only.
  type DragItem = { kind: 'goal'; goal: FiveYearGoal } | { kind: 'category'; category: string; year: number }
  type Action =
    | { kind: 'goalInto'; category: string; year: number; beforeId: string | null }
    | { kind: 'goalMove'; year: number; beforeId: string | null }
    | { kind: 'catMove'; toYear: number; beforeId: string | null }
    | { kind: 'trash' }
    | { kind: 'rename' }
  const dragRef = useRef<DragItem | null>(null)
  const actionRef = useRef<Action | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [dragging, setDragging] = useState(false)
  // True only while a category CARD is dragged, so the rename drop zone shows just for categories.
  const [draggingCategory, setDraggingCategory] = useState(false)
  // Structural equality so dragover (which fires continuously) doesn't re-render or allocate a JSON
  // string on every event; only a genuine change to the visual hint updates state.
  const setHintIf = (h: Hint) => setHint(prev => (hintEq(prev, h) ? prev : h))
  const edgeAfter = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY - r.top > r.height / 2
  }
  const dnd: Dnd = {
    hint,
    goalDragStart: (e, goal) => { dragRef.current = { kind: 'goal', goal }; setDragging(true); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', goal.id) },
    catDragStart: (e, category, year) => { dragRef.current = { kind: 'category', category, year }; setDragging(true); setDraggingCategory(true); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', category) },
    dragEnd: () => { dragRef.current = null; actionRef.current = null; setHint(null); setDragging(false); setDraggingCategory(false) },
    commit: e => {
      e.preventDefault(); e.stopPropagation()
      const d = dragRef.current, a = actionRef.current
      dnd.dragEnd()
      if (!d || !a) return
      if (a.kind === 'trash') {
        if (d.kind === 'goal') setPendingGoalDelete(d.goal)
        else {
          setPendingCatDelete({ category: d.category, year: d.year })
          // Only one year has this category: skip the this-year/all-years choice, nothing to choose.
          if (!categorySpansOtherYears(d.category, d.year)) setDeleteScope('year')
        }
        return
      }
      if (a.kind === 'rename') {
        if (d.kind === 'category') setCatToRename(d.category)
        return
      }
      if (a.kind === 'goalInto' && d.kind === 'goal') void applyGoals(placeGoal(goals, d.goal.id, a.category, a.year, a.beforeId))
      else if (a.kind === 'goalMove' && d.kind === 'goal') void applyGoals(placeGoal(goals, d.goal.id, d.goal.category, a.year, a.beforeId))
      else if (a.kind === 'catMove' && d.kind === 'category') void applyGoals(placeCategoryBlock(goals, d.category, d.year, a.toYear, a.beforeId))
    },
    // A goal over a row inside a card → insert at this row's edge, adopting the card's category. A
    // dragged category bubbles up to the card handler (don't preventDefault here for it).
    overRow: (goal, cardCategory, year, cardIds, idx) => e => {
      const d = dragRef.current
      if (d?.kind !== 'goal') return
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'
      const after = edgeAfter(e)
      actionRef.current = { kind: 'goalInto', category: cardCategory, year, beforeId: cardIds[after ? idx + 1 : idx] ?? null }
      setHintIf({ kind: 'line', key: goal.id, edge: after ? 'bottom' : 'top' })
    },
    // A GOAL over a category card's general area → INTO: join this category (highlight, append). A
    // category drag is ignored here so it bubbles to the column, which owns top-level positioning.
    overCatCard: (item, year) => e => {
      const d = dragRef.current
      if (d?.kind !== 'goal') return
      const key = `cat:${year}:${item.category.toLowerCase()}`
      if (item.allDone) revealForDrag(key)
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'
      actionRef.current = { kind: 'goalInto', category: item.category, year, beforeId: null }
      setHintIf({ kind: 'into', key })
    },
    // The column owns TOP-LEVEL positioning: measure the item cards and pick the gap under the pointer,
    // showing an orange insertion line (not a gray "somewhere in this year" box). A goal keeps its
    // category (categorized → re-homes to its card); a category card reorders/moves, merging if present.
    overColumn: (year, items, topIds) => e => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'
      if (items.length === 0) {
        actionRef.current = d.kind === 'goal' ? { kind: 'goalMove', year, beforeId: null } : { kind: 'catMove', toYear: year, beforeId: null }
        setHintIf({ kind: 'col', year })
        return
      }
      const kids = Array.from((e.currentTarget as HTMLElement).querySelectorAll(':scope > [data-fyitem]')) as HTMLElement[]
      let idx = kids.length
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) { idx = i; break }
      }
      const beforeId = topIds[idx] ?? null
      actionRef.current = d.kind === 'goal' ? { kind: 'goalMove', year, beforeId } : { kind: 'catMove', toYear: year, beforeId }
      if (idx < items.length) setHintIf({ kind: 'line', key: topItemKey(items[idx], year), edge: 'top' })
      else setHintIf({ kind: 'line', key: topItemKey(items[items.length - 1], year), edge: 'bottom' })
    },
  }
  const overTrash = (e: DragEvent) => {
    if (!dragRef.current) return
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'
    actionRef.current = { kind: 'trash' }
    setHintIf({ kind: 'trash' })
  }
  const overRename = (e: DragEvent) => {
    if (dragRef.current?.kind !== 'category') return
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'
    actionRef.current = { kind: 'rename' }
    setHintIf({ kind: 'rename' })
  }
  // Reveal a collapsed (all-done) category card while something is dragged over it, so its goals show.
  const revealForDrag = (key: string) => setExpanded(prev => (prev.has(key) ? prev : new Set(prev).add(key)))

  // Every goal delete confirms first: the card's tool is a one-click hover target and a trash drop can
  // land by accident, and neither has an undo behind it.
  const [pendingGoalDelete, setPendingGoalDelete] = useState<FiveYearGoal | null>(null)

  const goalActions = (g: FiveYearGoal): GoalActions => ({
    expanded: expanded.has(g.id),
    onToggleDone: () => void saveGoal({ ...g, done: !g.done }),
    onToggleExpand: () => toggleExpand(g.id),
    onEdit: () => setEditing({ goal: g, year: g.targetYear }),
    onDelete: () => setPendingGoalDelete(g),
  })

  // Category-card trash drop: a two-step flow. First pick the scope (this year / all years), then the
  // keep/delete-goals choice. Both cleared together on cancel or completion.
  const [pendingCatDelete, setPendingCatDelete] = useState<{ category: string; year: number } | null>(null)
  const [deleteScope, setDeleteScope] = useState<'year' | 'all' | null>(null)
  const resetCatDelete = () => { setPendingCatDelete(null); setDeleteScope(null) }
  const goalsUsingCategory = (name: string, year?: number) =>
    goals.filter(g => g.category?.toLowerCase() === name.toLowerCase() && (year === undefined || g.targetYear === year)).length
  const categorySpansOtherYears = (name: string, year: number) =>
    goals.some(g => g.category?.toLowerCase() === name.toLowerCase() && g.targetYear !== year)
  async function deleteCategory(name: string, year: number, scope: 'year' | 'all', alsoGoals: boolean) {
    const lower = name.toLowerCase()
    // "this year" touches only goals of this category in the dragged year; "all years" touches them all.
    const inScope = (g: FiveYearGoal) =>
      g.category?.toLowerCase() === lower && (scope === 'all' || g.targetYear === year)
    // Either drop the in-scope goals, or keep them and just clear the tag. One atomic write.
    const nextGoals = alsoGoals
      ? goals.filter(g => !inScope(g))
      : goals.map(g => (inScope(g) ? { ...g, category: undefined } : g))
    if (nextGoals.length !== goals.length || nextGoals.some((g, i) => g !== goals[i])) {
      setGoals(await window.tubemato.fiveYear.set(nextGoals))
    }
    // No explicit registry edit: the orphan-prune effect drops any category left with no goals, so
    // "all years" clears it, and a "this year" that empties it clears it too, while a category still
    // used in other years is kept automatically.
    resetCatDelete()
  }

  // Rename is global (every year's card adopts the new name) since a category is one shared registry entry.
  const [catToRename, setCatToRename] = useState<string | null>(null)
  const [pendingCatMerge, setPendingCatMerge] = useState<{ from: string; to: string } | null>(null)
  function requestCategoryRename(oldName: string, newName: string) {
    setCatToRename(null)
    if (!newName || newName === oldName) return
    const oldLower = oldName.toLowerCase()
    const target = categories.find(c => c.name.toLowerCase() === newName.toLowerCase() && c.name.toLowerCase() !== oldLower)
    if (target) setPendingCatMerge({ from: oldName, to: target.name })
    else void renameCategory(oldName, newName)
  }
  async function renameCategory(oldName: string, newName: string) {
    const oldLower = oldName.toLowerCase()
    const target = categories.find(c => c.name.toLowerCase() === newName.toLowerCase() && c.name.toLowerCase() !== oldLower)
    const canonical = target ? target.name : newName
    // Registry FIRST so the goals-driven orphan-prune effect sees the renamed entry instead of pruning it.
    const nextCats = target
      ? categories.filter(c => c.name.toLowerCase() !== oldLower)
      : categories.map(c => (c.name.toLowerCase() === oldLower ? { ...c, name: newName } : c))
    setSettings({ ...settings, fiveYearCategories: nextCats })
    void window.tubemato.settings.set({ fiveYearCategories: nextCats })
    const nextGoals = goals.map(g =>
      g.category?.toLowerCase() === oldLower ? { ...g, category: canonical } : g)
    if (nextGoals.some((g, i) => g !== goals[i])) {
      setGoals(await window.tubemato.fiveYear.set(nextGoals))
    }
    setPendingCatMerge(null)
  }

  // Once no goal carries a category, drop it from the registry (mirrors the card vanishing when emptied).
  useEffect(() => {
    const used = new Set(usedCategories(goals).map(c => c.toLowerCase()))
    const pruned = categories.filter(c => used.has(c.name.toLowerCase()))
    if (pruned.length !== categories.length) {
      void window.tubemato.settings.set({ fiveYearCategories: pruned })
      setSettings({ ...settings, fiveYearCategories: pruned })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals])

  // Defer reminder / summary popups while any confirm is open (goal delete, or a category
  // delete/rename/merge), so one can't pop over the choice being made.
  const dialogOpen = pendingGoalDelete !== null || pendingCatDelete !== null
    || catToRename !== null || pendingCatMerge !== null
  useEffect(() => {
    if (!dialogOpen) return
    const ui = useUiStore.getState()
    ui.openEditor()
    return () => ui.closeEditor()
  }, [dialogOpen])

  return (
    <div className="view fiveyear-view">
      <div className="view-header fiveyear-header">
        <div>
          <h1>Five-Year Plan</h1>
          <p>{fiveYearSubtitle(todayKey, settings.personality)}</p>
        </div>
        {progress.total > 0 && (
          <div className="fiveyear-header__right">
            <span className="fiveyear-progress">{progress.done} of {progress.total} done</span>
          </div>
        )}
      </div>

      <div className="fyboard">
        {years.map(y => {
          const items = yearItems(goals, y)
          // Representative goal id per top-level item, so a drop can insert before it in the array.
          const topIds = items.map(it => it.kind === 'category' ? it.goals[0].id : it.goal.id)
          return (
            <div className="fycol" key={y}>
              <div className="fycol__head">
                <span className="fycol__year">{y}</span>
                {y === currentYear && <span className="fycol__tag">This year</span>}
              </div>
              <div className={`fycol__body${hint?.kind === 'col' && hint.year === y ? ' fy-col-drop' : ''}`}
                onDragOver={dnd.overColumn(y, items, topIds)} onDrop={dnd.commit}>
                {items.map(it => it.kind === 'category' ? (
                  <CategoryCard
                    key={`cat:${it.category.toLowerCase()}`}
                    item={it}
                    year={y}
                    groups={categories}
                    dnd={dnd}
                    expandedKeys={expanded}
                    collapsed={it.allDone && !expanded.has(`cat:${y}:${it.category.toLowerCase()}`)}
                    onToggleCollapse={() => toggleExpand(`cat:${y}:${it.category.toLowerCase()}`)}
                    onAdd={() => setEditing({ year: y, category: it.category })}
                    goalActions={goalActions}
                  />
                ) : (
                  <LooseCard key={it.goal.id} goal={it.goal} groups={categories} dnd={dnd} {...goalActions(it.goal)} />
                ))}
                <button type="button" className="fycol__add" onClick={() => setEditing({ year: y })}>+ Add goal</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Portaled to <body> so their fixed position isn't trapped by a transformed ancestor. */}
      {dragging && createPortal(
        <div className="fy-dropzones">
          {draggingCategory && (
            <div className={`fy-dropzone fy-rename${hint?.kind === 'rename' ? ' fy-dropzone--over' : ''}`}
              onDragOver={overRename} onDrop={dnd.commit}>
              <PencilIcon size={24} />
              <span className="fy-dropzone__label">Drop to rename</span>
            </div>
          )}
          <div className={`fy-dropzone fy-trash${hint?.kind === 'trash' ? ' fy-dropzone--over' : ''}`}
            onDragOver={overTrash} onDrop={dnd.commit}>
            <TrashIcon size={26} />
            <span className="fy-dropzone__label">Drop to delete</span>
          </div>
        </div>,
        document.body,
      )}

      {editing && (
        <GoalForm
          initial={editing.goal}
          defaultYear={editing.year}
          defaultCategory={editing.category}
          currentYear={currentYear}
          keysPaused={!!pendingGoalDelete}
          onSave={g => void saveGoal(g)}
          onDelete={editing.goal ? () => setPendingGoalDelete(editing.goal!) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {pendingGoalDelete && (
        <GoalDeleteDialog
          goal={pendingGoalDelete}
          onCancel={() => setPendingGoalDelete(null)}
          onConfirm={() => {
            void removeGoal(pendingGoalDelete.id)
            setPendingGoalDelete(null)
            setEditing(null)   // no-op unless the delete came from the edit form
          }}
        />
      )}
      {pendingCatDelete && !deleteScope && (
        <CategoryScopeDialog
          name={pendingCatDelete.category}
          year={pendingCatDelete.year}
          onCancel={resetCatDelete}
          onPick={setDeleteScope}
        />
      )}
      {pendingCatDelete && deleteScope && (
        <CategoryDeleteDialog
          name={pendingCatDelete.category}
          year={deleteScope === 'year' ? pendingCatDelete.year : undefined}
          goalCount={goalsUsingCategory(pendingCatDelete.category, deleteScope === 'year' ? pendingCatDelete.year : undefined)}
          onCancel={resetCatDelete}
          onConfirm={alsoGoals => void deleteCategory(pendingCatDelete.category, pendingCatDelete.year, deleteScope, alsoGoals)}
        />
      )}
      {catToRename && (
        <CategoryRenameDialog
          name={catToRename}
          onCancel={() => setCatToRename(null)}
          onSubmit={newName => requestCategoryRename(catToRename, newName)}
        />
      )}
      {pendingCatMerge && (
        <CategoryMergeDialog
          from={pendingCatMerge.from}
          to={pendingCatMerge.to}
          goalCount={goalsUsingCategory(pendingCatMerge.from)}
          onCancel={() => setPendingCatMerge(null)}
          onConfirm={() => void renameCategory(pendingCatMerge.from, pendingCatMerge.to)}
        />
      )}
    </div>
  )
}
