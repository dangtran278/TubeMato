import { useEffect, useRef, useState, useCallback } from 'react'
import { useSettingsStore } from '../store'

export interface YouTubePlayerState {
  loaded: boolean
  error: string | null
  videoTitle: string
  isPlaylist: boolean
  currentUrl: string
}

declare global {
  interface Window {
    YT: typeof YT
    onYouTubeIframeAPIReady: () => void
  }
}

function extractYouTubeId(url: string): { videoId?: string; playlistId?: string } | null {
  if (!url) return null
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const listId = u.searchParams.get('list')
    const videoId = u.searchParams.get('v') || (u.hostname === 'youtu.be' ? u.pathname.slice(1) : undefined)
    if (listId || videoId) return { videoId: videoId ?? undefined, playlistId: listId ?? undefined }
    // Plain video ID (11 chars)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return { videoId: url.trim() }
    return null
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return { videoId: url.trim() }
    return null
  }
}

export function useYouTube(containerRef: React.RefObject<HTMLDivElement>) {
  const playerRef = useRef<YT.Player | null>(null)
  const [state, setState] = useState<YouTubePlayerState>({
    loaded: false, error: null, videoTitle: '', isPlaylist: false, currentUrl: '',
  })
  const { settings } = useSettingsStore()

  // Load the IFrame API script once
  useEffect(() => {
    if (window.YT?.Player) return
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  }, [])

  const loadUrl = useCallback((url: string) => {
    const parsed = extractYouTubeId(url)
    if (!parsed) {
      setState(s => ({ ...s, error: 'Invalid YouTube URL or video ID', loaded: false }))
      return
    }

    const { videoId, playlistId } = parsed
    setState(s => ({ ...s, error: null, currentUrl: url, isPlaylist: !!playlistId }))

    function initPlayer() {
      if (!containerRef.current) return
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }

      const div = document.createElement('div')
      div.id = 'yt-player-' + Date.now()
      containerRef.current.innerHTML = ''
      containerRef.current.appendChild(div)

      playerRef.current = new window.YT.Player(div.id, {
        height: '100%',
        width: '100%',
        videoId: playlistId ? undefined : videoId,
        playerVars: {
          listType: playlistId ? 'playlist' : undefined,
          list: playlistId,
          controls: settings.youtubeHideControls ? 0 : 1,
          rel: 0,
          modestbranding: 1,
          autoplay: 0,
          origin: 'https://tubemato.app',
        } as YT.PlayerVars,
        events: {
          onReady: e => {
            setState(s => ({ ...s, loaded: true, error: null }))
            if (settings.youtubeShuffle && playlistId) {
              e.target.setShuffle(true)
            }
          },
          onStateChange: e => {
            // Update title when a new video plays
            if (e.data === window.YT.PlayerState.PLAYING) {
              const title = e.target.getVideoData?.()?.title ?? ''
              setState(s => ({ ...s, videoTitle: title }))
            }
          },
          onError: e => {
            // 101/150 = not embeddable; 100 = not found; 5 = HTML5 error
            const msg = (e.data === 101 || e.data === 150)
              ? "This video can't be played here. Timer continues without YouTube control."
              : 'Failed to load video. Timer continues.'
            setState(s => ({ ...s, error: msg, loaded: false }))
          },
        },
      })
    }

    if (window.YT?.Player) {
      initPlayer()
    } else {
      window.onYouTubeIframeAPIReady = initPlayer
    }
  }, [settings.youtubeHideControls, settings.youtubeShuffle, containerRef])

  const nextTrack = useCallback(() => playerRef.current?.nextVideo?.(), [])
  const prevTrack = useCallback(() => playerRef.current?.previousVideo?.(), [])

  return { player: playerRef.current, state, loadUrl, nextTrack, prevTrack }
}
