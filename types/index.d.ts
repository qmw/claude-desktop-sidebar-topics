/** What kind of input a session is waiting for. */
export type NeedsInputKind = 'question' | 'choice' | 'approval' | 'decision' | 'request'

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
  /** The tail of that session's transcript, for a thread's context. */
  context?: string
}

/** A side thread opened on one topic from the pane. */
export type Thread = {
  /** The item's key the thread was opened from (a local key or a session id). */
  key: string
  /**
   * The thread's own id: a session id (`via: 'session'`) or an agent id; ''
   * while the thread is a proposal card the person has not started yet.
   */
  id: string
  /** The session's title, by which a proposed thread is found once started. */
  title?: string
  /** A session of its own (the desktop app) or a subagent (a terminal). */
  via: 'session' | 'agent'
  question: string
  startedAt: number
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
  /** How many sessions the last refresh skipped because a call did not answer in time. */
  skipped: number
  /** While checking: "n/m" of the other sessions read so far; null otherwise. */
  progress: string | null
  error: string | null
  isChecking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'desktop-sidebar-topics': {
      snapshot: Shaped<NeedsInputSnapshot>
      /** Keys of this conversation's questions the person ticked off. */
      dismissed: Shaped<string[]>
      /** The side threads opened from the pane, oldest first. */
      threads: Shaped<Thread[]>
    }
  }
}
