import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Manages the YouTube WebContentsView overlay by sending bounds updates
 * to the main process via IPC. The main process positions the real YouTube
 * browser pane to match our placeholder div exactly.
 */
export function useYouTube(panelRef: React.RefObject<HTMLDivElement>) {
  const [urlInput, setUrlInput] = useState('https://www.youtube.com')
  const [isVisible, setIsVisible] = useState(true)

  const updateBounds = useCallback(() => {
    if (!panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    window.tubemato.youtube.setBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width:  Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [panelRef])

  // Update bounds whenever the placeholder div resizes (handles window resize too)
  useEffect(() => {
    if (!panelRef.current) return
    const obs = new ResizeObserver(updateBounds)
    obs.observe(panelRef.current)
    updateBounds()
    return () => obs.disconnect()
  }, [panelRef.current, updateBounds])

  const navigate = useCallback((rawUrl: string) => {
    if (!rawUrl.trim()) return
    // Treat non-URL strings as YouTube search queries
    const url = rawUrl.startsWith('http')
      ? rawUrl
      : rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be')
        ? `https://${rawUrl}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(rawUrl)}`
    window.tubemato.youtube.navigate(url)
    setUrlInput(url)
    // Make sure view is visible after navigation
    if (!isVisible) {
      window.tubemato.youtube.show(true)
      setIsVisible(true)
    }
    updateBounds()
  }, [isVisible, updateBounds])

  const show = useCallback(() => {
    window.tubemato.youtube.show(true)
    setIsVisible(true)
    updateBounds()
  }, [updateBounds])

  const hide = useCallback(() => {
    window.tubemato.youtube.show(false)
    setIsVisible(false)
  }, [])

  const toggle = useCallback(() => {
    setIsVisible(prev => {
      const next = !prev
      window.tubemato.youtube.show(next)
      if (next) updateBounds()
      return next
    })
  }, [updateBounds])

  return { urlInput, setUrlInput, navigate, show, hide, toggle, isVisible, updateBounds }
}
