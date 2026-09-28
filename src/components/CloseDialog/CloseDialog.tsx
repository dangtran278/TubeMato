import { useEffect, useRef, useState } from 'react'
import type { Personality } from '@electron/types'
import { closeDialogTitle, closeDialogBody } from '@electron/personalityCopy'
import './CloseDialog.css'

/** Title-bar ✕ while the Close button setting is Ask. "Don't ask again" saves the clicked choice. */
export default function CloseDialog({ personality, onCancel }: {
  personality: Personality
  onCancel: () => void
}) {
  const [dontAsk, setDontAsk] = useState(false)
  const busy = useRef(false)

  async function choose(action: 'tray' | 'quit') {
    if (busy.current) return
    busy.current = true
    // Awaited so the setting is stored before this renderer goes away.
    if (dontAsk) await window.tubemato.settings.set({ closeButtonAction: action })
    if (action === 'quit') window.tubemato.app.quit()
    else window.tubemato.app.close()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const downOnBackdrop = useRef(false)
  return (
    <div className="group-delete-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onCancel(); downOnBackdrop.current = false }}>
      <div className="group-delete-modal close-dialog__modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">{closeDialogTitle(personality)}</div>
        <p className="group-delete-modal__body">{closeDialogBody(personality)}</p>
        <div className="close-dialog__footer">
          <div className="close-dialog__dont-ask-group">
            <label className="close-dialog__dont-ask">
              <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} />
              Don't ask again
            </label>
            <span className="close-dialog__hint">You can change this in Settings › System.</span>
          </div>
          <div className="group-delete-modal__actions close-dialog__actions">
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn group-delete-keep" onClick={() => void choose('tray')}>Keep running in tray</button>
            <button className="btn group-delete-danger" onClick={() => void choose('quit')}>Quit</button>
          </div>
        </div>
      </div>
    </div>
  )
}
