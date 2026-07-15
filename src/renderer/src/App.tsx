import { useCallback, useEffect, useRef, useState } from 'react'
import SwipeDeck, { DeckStats } from './SwipeDeck'
import type { ScanProgress, ScanResult } from '../../shared/types'

type Screen =
  | { name: 'pick'; error?: string }
  | { name: 'scanning'; progress: ScanProgress | null }
  | { name: 'sorting'; scan: ScanResult }
  | { name: 'done'; stats: DeckStats; skippedKept: number }

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'pick' })
  const skippedRef = useRef(0)

  useEffect(() => {
    if (screen.name !== 'scanning') return
    return window.api.onScanProgress((progress) => {
      setScreen((s) => (s.name === 'scanning' ? { name: 'scanning', progress } : s))
    })
  }, [screen.name])

  const picking = useRef(false)

  const pickAndScan = useCallback(async () => {
    // The native dialog is async and the triggering button stays clickable —
    // guard against stacking dialogs / racing scans.
    if (picking.current) return
    picking.current = true
    try {
      const root = await window.api.chooseDir()
      if (!root) return
      setScreen({ name: 'scanning', progress: null })
      try {
        const scan = await window.api.scan(root)
        skippedRef.current = scan.skippedKept
        setScreen({ name: 'sorting', scan })
      } catch (err) {
        setScreen({ name: 'pick', error: String(err) })
      }
    } finally {
      picking.current = false
    }
  }, [])

  const onDone = useCallback((stats: DeckStats) => {
    setScreen({ name: 'done', stats, skippedKept: skippedRef.current })
  }, [])

  switch (screen.name) {
    case 'pick':
      return (
        <div className="screen center">
          <h1 className="title">Picnic Desktop</h1>
          <p className="subtitle">
            Pick a folder. Swipe through every photo in it — left to delete, right to keep.
          </p>
          <button className="primary" onClick={pickAndScan}>
            Choose folder to sort
          </button>
          {screen.error && <p className="error">{screen.error}</p>}
          <p className="hint">
            Deleted photos go to the {navigator.platform.startsWith('Mac') ? 'Trash' : 'Recycle Bin'}
            . Kept photos are remembered and never shown again.
          </p>
        </div>
      )
    case 'scanning':
      return (
        <div className="screen center">
          <h2 className="subtitle">Scanning…</h2>
          <p className="progress">
            {screen.progress === null
              ? 'Looking for images…'
              : screen.progress.phase === 'walking'
                ? `Found ${screen.progress.count} images…`
                : `Reading dates… ${screen.progress.count} / ${screen.progress.total}`}
          </p>
        </div>
      )
    case 'sorting':
      if (screen.scan.photos.length === 0) {
        return (
          <div className="screen center">
            <h2 className="subtitle">Nothing to sort</h2>
            <p className="progress">
              No new images found
              {skippedRef.current > 0 ? ` (${skippedRef.current} already kept)` : ''}.
            </p>
            <button className="primary" onClick={pickAndScan}>
              Choose another folder
            </button>
          </div>
        )
      }
      return (
        <SwipeDeck
          root={screen.scan.root}
          photos={screen.scan.photos}
          onDone={onDone}
          onSwitchFolder={pickAndScan}
        />
      )
    case 'done':
      return (
        <div className="screen center">
          <h1 className="title">All done 🎉</h1>
          <p className="progress">
            Kept {screen.stats.kept} · Deleted {screen.stats.deleted}
            {screen.skippedKept > 0 ? ` · ${screen.skippedKept} skipped (already kept)` : ''}
          </p>
          <button className="primary" onClick={pickAndScan}>
            Sort another folder
          </button>
        </div>
      )
  }
}
