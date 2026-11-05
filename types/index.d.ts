/** What kind of input a session is waiting for. */
export type NeedsInputKind = 'question' | 'choice' | 'approval' | 'decision'

/** One other session that waits for the person. */
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

/** One open question of this conversation. */
export type LocalItem = {
  /** Stable address: message index plus the question (or the tool call id). */
  key: string
  question: string
  kind: NeedsInputKind
  /** Index of the assistant message that asked it, in `$.session.messages()`. */
  messageIndex: number
}

/** The last refresh's outcome, what the pane draws from. */
export type NeedsInputSnapshot = {
  /** Open questions of this conversation, in the order they were asked. */
  local: LocalItem[]
  /** Other sessions waiting for the person, newest first. */
  items: NeedsInputItem[]
  /** Milliseconds since the epoch of the last finished refresh; 0 before one. */
  checkedAt: number
  /** How many other sessions the last refresh looked at. */
  checked: number
  error: string | null
  isChecking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'desktop-sidebar-topics': {
      snapshot: Shaped<NeedsInputSnapshot>
      /** Keys of this conversation's questions the person ticked off. */
      dismissed: Shaped<string[]>
    }
  }
}
