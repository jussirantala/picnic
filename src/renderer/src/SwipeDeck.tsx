import { useCallback, useEffect, useRef, useState } from 'react'
import type { PhotoEntry } from '../../shared/types'

export interface DeckStats {
  kept: number
  deleted: number
}

interface Props {
  root: string
  photos: PhotoEntry[]
  onDone: (stats: DeckStats) => void
  onSwitchFolder: () => void
}

type Dir = 'left' | 'right'

interface Ghost {
  id: number
  path: string
  kind: 'image' | 'video'
  dir: Dir
}

interface LastAction {
  type: 'keep' | 'delete'
  entry: PhotoEntry
}

const SWIPE_THRESHOLD = 120
const PRELOAD_AHEAD = 5

/**
 * Deletes are deferred by one action: a left-swiped photo is only sent to the
 * recycle bin when the *next* action happens (or the deck finishes). This is
 * what makes Undo of a delete possible — shell.trashItem has no programmatic
 * restore.
 */
export default function SwipeDeck({
  root,
  photos,
  onDone,
  onSwitchFolder
}: Props): React.JSX.Element {
  const [queue, setQueue] = useState<PhotoEntry[]>(photos)
  const [stats, setStats] = useState<DeckStats>({ kept: 0, deleted: 0 })
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const [showTrashToast, setShowTrashToast] = useState(
    () => localStorage.getItem('trashToastShown') !== '1'
  )

  const pendingDelete = useRef<PhotoEntry | null>(null)
  const lastAction = useRef<LastAction | null>(null)
  const ghostId = useRef(0)
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const preloaded = useRef<HTMLImageElement[]>([])

  const total = photos.length
  const position = total - queue.length + 1
  const current: PhotoEntry | undefined = queue[0]

  const commitPendingDelete = useCallback(() => {
    const pending = pendingDelete.current
    if (!pending) return
    pendingDelete.current = null
    // Fire-and-forget: trash failures should not block the sorting flow.
    window.api.trash(pending.path).catch((err) => console.error('trash failed', err))
  }, [])

  // Preload the next few images so fast keyboard triage never waits on disk.
  // Videos are skipped — they stream on demand.
  useEffect(() => {
    const imgs: HTMLImageElement[] = []
    for (const entry of queue.slice(1, 1 + PRELOAD_AHEAD)) {
      if (entry.kind !== 'image') continue
      const img = new Image()
      img.src = window.api.photoUrl(entry.path)
      imgs.push(img)
    }
    preloaded.current = imgs
  }, [queue])

  useEffect(() => {
    setImgFailed(false)
  }, [current?.path])

  // Flush a pending delete when the deck unmounts (switching folders) and when
  // the window closes mid-sort — React cleanups do NOT run on window close, so
  // a beforeunload listener is required; the trash IPC is fire-and-forget.
  useEffect(() => commitPendingDelete, [commitPendingDelete])
  useEffect(() => {
    window.addEventListener('beforeunload', commitPendingDelete)
    return () => window.removeEventListener('beforeunload', commitPendingDelete)
  }, [commitPendingDelete])

  useEffect(() => {
    if (queue.length === 0) {
      commitPendingDelete()
      onDone(stats)
    }
  }, [queue.length, stats, onDone, commitPendingDelete])

  // A keyboard action or undo can land mid-drag; the card element keeps pointer
  // capture and the stale drag baseline would swipe the NEXT photo on release.
  const abortDrag = useCallback(() => {
    const drag = dragStart.current
    if (drag && cardRef.current) {
      try {
        cardRef.current.releasePointerCapture(drag.pointerId)
      } catch {
        // Capture may already be gone; nothing to release.
      }
    }
    dragStart.current = null
    setDx(0)
    setDragging(false)
  }, [])

  const act = useCallback(
    (dir: Dir) => {
      const entry = queue[0]
      if (!entry) return
      if (showTrashToast) {
        localStorage.setItem('trashToastShown', '1')
        setShowTrashToast(false)
      }

      commitPendingDelete()

      if (dir === 'left') {
        pendingDelete.current = entry
        lastAction.current = { type: 'delete', entry }
        setStats((s) => ({ ...s, deleted: s.deleted + 1 }))
      } else {
        lastAction.current = { type: 'keep', entry }
        setStats((s) => ({ ...s, kept: s.kept + 1 }))
        window.api.keep(root, entry.path).catch((err) => console.error('keep failed', err))
      }

      // Non-blocking exit animation: state advances immediately, the ghost
      // card animates out on its own.
      const id = ghostId.current++
      setGhosts((g) => [...g, { id, path: entry.path, kind: entry.kind, dir }])
      setQueue((q) => q.slice(1))
      abortDrag()
    },
    [queue, root, commitPendingDelete, showTrashToast, abortDrag]
  )

  const undo = useCallback(() => {
    const last = lastAction.current
    if (!last) return
    lastAction.current = null
    abortDrag()

    if (last.type === 'delete') {
      // The delete is still pending (deferred), so cancelling is enough.
      pendingDelete.current = null
      setStats((s) => ({ ...s, deleted: s.deleted - 1 }))
    } else {
      window.api.unkeep(root, last.entry.path).catch((err) => console.error('unkeep failed', err))
      setStats((s) => ({ ...s, kept: s.kept - 1 }))
    }
    setQueue((q) => [last.entry, ...q])
  }, [root, abortDrag])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Leave shortcuts like Ctrl+A / Cmd+Z to the browser — bare keys only.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        act('left')
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        act('right')
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, undo])

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    dragStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragStart.current || e.pointerId !== dragStart.current.pointerId) return
    setDx(e.clientX - dragStart.current.x)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (!dragStart.current || e.pointerId !== dragStart.current.pointerId) return
    const finalDx = e.clientX - dragStart.current.x
    dragStart.current = null
    if (finalDx <= -SWIPE_THRESHOLD) {
      act('left')
    } else if (finalDx >= SWIPE_THRESHOLD) {
      act('right')
    } else {
      setDx(0)
      setDragging(false)
    }
  }

  // pointercancel carries clientX = 0 (spec quirk), which would look like a big
  // left swipe and trash a photo the user never chose — always just reset.
  const onPointerCancel = (e: React.PointerEvent): void => {
    if (!dragStart.current || e.pointerId !== dragStart.current.pointerId) return
    abortDrag()
  }

  if (!current) {
    // Queue drained; the effect above fires onDone. Render nothing meanwhile.
    return <div className="screen" />
  }

  const overlayStrength = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1)
  const date = new Date(current.date)

  return (
    <div className="screen deck">
      <header className="deck-header">
        <span>
          {position} / {total}
        </span>
        <span className="deck-date">
          {date.toLocaleDateString()} {date.toLocaleTimeString()}
        </span>
        <span className="deck-stats">
          kept {stats.kept} · deleted {stats.deleted}
          <button className="switch-folder" onClick={onSwitchFolder} title="Switch folder">
            📁 Switch folder
          </button>
        </span>
      </header>

      <div className="card-area">
        {ghosts.map((g) => (
          <div
            key={g.id}
            className={`card ghost ${g.dir === 'left' ? 'fly-left' : 'fly-right'}`}
            onAnimationEnd={() => setGhosts((gs) => gs.filter((x) => x.id !== g.id))}
          >
            {g.kind === 'image' && (
              <img src={window.api.photoUrl(g.path)} alt="" draggable={false} />
            )}
          </div>
        ))}

        <div
          ref={cardRef}
          className={`card ${dragging ? 'dragging' : 'settled'}`}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {imgFailed ? (
            <div className="no-preview">
              <p>No preview available</p>
              <p className="hint">
                (HEIC and some video codecs can’t be shown — you can still keep or delete it)
              </p>
              <p className="filename">{current.path}</p>
            </div>
          ) : current.kind === 'video' ? (
            <video
              key={current.path}
              src={window.api.photoUrl(current.path)}
              autoPlay
              muted
              loop
              playsInline
              onError={() => setImgFailed(true)}
            />
          ) : (
            <img
              src={window.api.photoUrl(current.path)}
              alt={current.path}
              draggable={false}
              onError={() => setImgFailed(true)}
            />
          )}
          <div className="overlay delete" style={{ opacity: dx < 0 ? overlayStrength : 0 }}>
            DELETE
          </div>
          <div className="overlay keep" style={{ opacity: dx > 0 ? overlayStrength : 0 }}>
            KEEP
          </div>
        </div>
      </div>

      <footer className="deck-footer">
        <button className="action delete" onClick={() => act('left')} title="Delete (Left arrow)">
          ✕ Delete
          <span className="key-hint">← arrow</span>
        </button>
        <button className="action undo" onClick={undo} title="Undo (Backspace or Z)">
          ↩ Undo
          <span className="key-hint">Backspace</span>
        </button>
        <button className="action keep" onClick={() => act('right')} title="Keep (Right arrow)">
          ✓ Keep
          <span className="key-hint">→ arrow</span>
        </button>
      </footer>

      <p className="filename-bar" title={current.path}>
        {current.path}
      </p>

      {showTrashToast && (
        <div className="toast">
          Deleted photos go to the{' '}
          {navigator.platform.startsWith('Mac') ? 'Trash' : 'Recycle Bin'} — nothing is lost
          permanently.
        </div>
      )}
    </div>
  )
}
