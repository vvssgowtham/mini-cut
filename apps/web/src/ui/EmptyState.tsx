/**
 * What the viewer shows before there is anything to show.
 *
 * An invitation, not a blank: the first thing a new visitor needs is where to start, and the
 * line about the file staying put answers the question they have before they pick one.
 */

import type { ReactNode } from 'react'
import { Icon } from './Icons'

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="viewer-drop">
      <span className="drop-icon">
        <Icon name="video" size={28} />
      </span>
      <h2>Import a video to start cutting</h2>
      <p>It stays on this device {'—'} nothing is uploaded.</p>
      {children}
    </div>
  )
}
