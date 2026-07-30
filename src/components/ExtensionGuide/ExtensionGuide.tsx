import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../store'
import './ExtensionGuide.css'

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

/** First-run (and on-demand) walkthrough for installing the YouTube bridge extension. */
export default function ExtensionGuide({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useSettingsStore()
  const [path, setPath] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [dontShow, setDontShow] = useState(settings.hideExtensionGuide ?? false)

  useEffect(() => {
    window.tubemato.app.getBridgeExtensionPath().then(setPath)
  }, [])

  async function openFolder() {
    setMsg(null)
    const r = await window.tubemato.app.openBridgeExtensionFolder()
    setMsg(r.ok ? 'Opened folder in your file explorer.' : r.error)
  }

  async function copyPath() {
    if (!path) return
    await navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyUrl() {
    await navigator.clipboard.writeText('chrome://extensions')
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  function toggleDontShow(v: boolean) {
    setDontShow(v)
    void window.tubemato.app.setExtensionGuideHidden(v)
    setSettings({ ...settings, hideExtensionGuide: v })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal ext-guide">
        <div className="modal__header">
          <span className="modal__title">🎬 Connect TubeMato to YouTube</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <p className="ext-guide__intro">
            Optional: install the bridge extension so TubeMato can fade your YouTube
            music in and out with your focus and break blocks. Skip it and the timer
            still works, just without music control.
          </p>
          <ol className="ext-guide__steps">
            <li>
              Open{' '}
              <span className="ext-guide__url-group">
                <code>chrome://extensions</code>
                <button type="button" className="ext-guide__url-copy" onClick={copyUrl} title="Copy">
                  {copiedUrl ? '✓' : <CopyIcon />}
                </button>
              </span>
              {' '}in Chrome or Brave.
            </li>
            <li>Turn on <strong>Developer mode</strong> (top-right).</li>
            <li>Click <strong>Load unpacked</strong>.</li>
            <li>Select the TubeMato bridge folder (open it with the button below).</li>
            <li>Open a YouTube tab. The bridge connects automatically.</li>
          </ol>
          <div className="ext-guide__folder-group">
            <button type="button" className="btn btn-ghost" onClick={openFolder}>
              Open extension folder
            </button>
            {path && (
              <div className="ext-guide__path-row">
                <span className="ext-guide__path" title={path}>{path}</span>
                <button
                  type="button"
                  className="ext-guide__copy"
                  onClick={copyPath}
                  title="Copy path"
                >
                  {copied ? '✓' : <CopyIcon />}
                </button>
              </div>
            )}
            {msg && <div className="ext-guide__msg">{msg}</div>}
          </div>
        </div>
        <div className="modal__footer ext-guide__footer">
          <div className="ext-guide__footer-left">
            <label className="ext-guide__dont-show">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={e => toggleDontShow(e.target.checked)}
              />
              Don't show on startup
            </label>
            <span className="ext-guide__settings-hint">You can access this guide in Settings.</span>
          </div>
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}
