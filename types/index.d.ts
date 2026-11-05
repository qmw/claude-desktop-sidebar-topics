/** What kind of input a session is waiting for. */
export type NeedsInputKind = 'question' | 'choice' | 'approval'

/** One session that waits for the person. */
export type NeedsInputItem = {
  sessionId: string
  /** The session's title, as the sidebar shows it. */
  title: string
  /** The question or the tool that waits, cut to one line. */
  summary: string
  kind: NeedsInputKind
  /** ISO time of the session's last activity. */
  since: string
  /** The app link that opens the session (claude://...). */
  link: string
}

/** The last refresh's outcome, what the pane draws from. */
export type NeedsInputSnapshot = {
  items: NeedsInputItem[]
  /** Milliseconds since the epoch of the last finished refresh; 0 before one. */
  checkedAt: number
  /** How many sessions the last refresh looked at. */
  checked: number
  error: string | null
  isChecking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'desktop-sidebar-topics': {
      snapshot: Shaped<NeedsInputSnapshot>
    }
  }
}
