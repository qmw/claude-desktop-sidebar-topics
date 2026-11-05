import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NeedsInputItem, NeedsInputKind, NeedsInputSnapshot } from '../types'

// ---------------------------------------------------------------------------
// desktop-sidebar-topics: a pane that lists the sessions waiting for the person's answer.
//
// Data source: the desktop app's own session-management MCP server
// (`ccd_session_mgmt`): `list_sessions` for the rows, `list_events` for the
// tail of each idle session's transcript, from which the kind of input it
// waits for is derived. Nothing is invented: a session is listed only when
// its transcript ends in an unanswered question, an AskUserQuestion prompt
// or a tool call that never got its result (a permission prompt).
// ---------------------------------------------------------------------------

const PLUGIN = 'desktop-sidebar-topics'
const PANE = 'sidebar-topics'
const COMMAND = 'sidebar-topics'
const SERVER = 'ccd_session_mgmt'
const WINDOW_SERVER = 'ccd_window'
const STORE_HIDDEN = 'hidden'

const EMPTY: NeedsInputSnapshot = {
  items: [],
  checkedAt: 0,
  checked: 0,
  error: null,
  isChecking: false,
}

// Change the tag when the snapshot's fields change: an older stored value is
// then read as EMPTY instead of crashing the drawing.
const snapshot = atom({ plugin: 'desktop-sidebar-topics', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-1',
})

type Lang = 'pl' | 'en'

const WORDS = {
  pl: {
    title: 'Czeka na Ciebie',
    none: 'Nic nie czeka na Twoją odpowiedź.',
    checking: 'Sprawdzam sesje…',
    checked: (n: number, at: string) => `sprawdzono ${n} sesji o ${at}`,
    refresh: 'Odśwież',
    close: 'Zamknij',
    kinds: {
      question: 'pytanie',
      choice: 'wybór opcji',
      approval: 'zgoda na narzędzie',
    } as Record<NeedsInputKind, string>,
    opened: (t: string) => `Otwieram: ${t}`,
    copied: 'Nie mogę przełączyć sesji z moda. Link skopiowany do schowka; otwórz sesję z paska bocznego lub wklej link w przeglądarce.',
    newItems: (n: number) => (n === 1 ? '1 sesja czeka na Twoją odpowiedź' : `${n} sesje czekają na Twoją odpowiedź`),
    paneOpened: 'Panel „Czeka na Ciebie” otwarty.',
    paneClosed: 'Panel „Czeka na Ciebie” zamknięty.',
    refreshed: 'Lista odświeżona.',
    status: (n: number) => (n === 0 ? undefined : `⏳ ${n} czeka na odpowiedź`),
    ago: (s: number) => (s < 60 ? 'przed chwilą' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`),
  },
  en: {
    title: 'Needs your input',
    none: 'Nothing is waiting for your answer.',
    checking: 'Checking sessions…',
    checked: (n: number, at: string) => `checked ${n} sessions at ${at}`,
    refresh: 'Refresh',
    close: 'Close',
    kinds: {
      question: 'question',
      choice: 'choice to make',
      approval: 'tool approval',
    } as Record<NeedsInputKind, string>,
    opened: (t: string) => `Opening: ${t}`,
    copied: 'The mod cannot switch sessions on this surface. Link copied to the clipboard; open the session from the sidebar or paste the link in a browser.',
    newItems: (n: number) => (n === 1 ? '1 session waits for your answer' : `${n} sessions wait for your answer`),
    paneOpened: 'Sidebar-topics pane opened.',
    paneClosed: 'Sidebar-topics pane closed.',
    refreshed: 'List refreshed.',
    status: (n: number) => (n === 0 ? undefined : `⏳ ${n} waiting for you`),
    ago: (s: number) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`),
  },
} as const

const KIND_GLYPH: Record<NeedsInputKind, string> = {
  question: '❓',
  choice: '☑',
  approval: '🔒',
}

// ---------------------------------------------------------------------------
// Reading the app's session data
// ---------------------------------------------------------------------------

type SessionRow = {
  sessionId: string
  title?: string
  isArchived?: boolean
  isRunning?: boolean
  lastActivityAt?: string
  link?: string
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

async function listSessions($: EngineInterface, limit: number): Promise<SessionRow[]> {
  const result = await $.mcp.call(SERVER, 'list_sessions', { limit })
  const text = textOf(result)
  if (result.isError) throw new Error(text || 'list_sessions failed')
  const start = text.indexOf('[')
  const parsed: unknown = JSON.parse(start >= 0 ? text.slice(start) : text)
  if (!Array.isArray(parsed)) throw new Error('list_sessions answered no list')
  return parsed.filter((row): row is SessionRow => typeof row === 'object' && row !== null && typeof (row as SessionRow).sessionId === 'string')
}

type Entry = { tag: string; text: string }

/** Splits a `list_events` rendering into its `[tag] text` entries. */
function parseTranscript(text: string): { state: string; entries: Entry[] } {
  const lines = text.split(/\r?\n/)
  const header = lines[0] ?? ''
  const stateMatch = /\(([^)]+)\)\s+[—-]+\s+showing/.exec(header)
  const state = stateMatch?.[1] ?? ''
  const entries: Entry[] = []
  for (const line of lines.slice(1)) {
    const tagged = /^\[([a-z_-]+)\]\s?(.*)$/i.exec(line)
    if (tagged) {
      entries.push({ tag: tagged[1]!.toLowerCase(), text: tagged[2] ?? '' })
    } else if (entries.length > 0) {
      entries[entries.length - 1]!.text += '\n' + line
    }
  }
  return { state, entries }
}

const CALLED = /^\(called ([^)]+)\)\s*$/

function oneLine(text: string, max = 120): string {
  const lines = text
    .split('\n')
    .map(line => line.replace(/[*_`#>]+/g, '').trim())
    .filter(line => line.length > 0)
  // The question is usually the last line; prefer it when it is one.
  const last = lines[lines.length - 1] ?? ''
  const pick = last.endsWith('?') ? last : lines.find(line => line.endsWith('?')) ?? last
  return pick.length > max ? pick.slice(0, max - 1) + '…' : pick
}

type Need = { kind: NeedsInputKind; summary: string; pendingTool?: string }

/**
 * What a session's transcript tail says it is waiting for, or null.
 *
 * A session blocked at a prompt (AskUserQuestion, a permission dialog) is
 * reported by the app as running, so `isRunning` decides nothing by itself:
 * while running, only a pending AskUserQuestion counts at once; any other
 * pending tool call counts once it has stayed pending for a while (the caller
 * times it), since a tool may simply be executing.
 */
function deriveNeed(transcript: string, isRunning: boolean): Need | null {
  const { entries } = parseTranscript(transcript)
  if (entries.length === 0) return null
  const last = entries[entries.length - 1]!

  // Last assistant text said before the final entry: the question itself.
  // With none (the question was asked straight away), the person's own last
  // prompt names the topic.
  const lastSaid = [...entries]
    .reverse()
    .find(entry => entry.tag === 'assistant' && !CALLED.test(entry.text.trim()))
  const lastAsked = [...entries].reverse().find(entry => entry.tag === 'user')
  const topic = lastSaid ? oneLine(lastSaid.text) : lastAsked ? oneLine(lastAsked.text, 80) : ''

  if (last.tag === 'assistant') {
    const call = CALLED.exec(last.text.trim())
    if (call) {
      const tool = call[1]!
      if (tool === 'AskUserQuestion') {
        return { kind: 'choice', summary: topic || 'AskUserQuestion' }
      }
      // A call with no result: a permission prompt, or a tool still running.
      return { kind: 'approval', summary: topic ? `${tool} — ${topic}` : tool, pendingTool: tool }
    }
    if (isRunning) return null
    const said = oneLine(last.text)
    if (said.endsWith('?')) return { kind: 'question', summary: said }
    return null
  }

  if (isRunning) return null

  if (last.tag === 'result') {
    // A wrap-up's result follows the closing message in some renderings: the
    // question is then the assistant text right before it.
    const previous = entries[entries.length - 2]
    if (previous && previous.tag === 'assistant' && !CALLED.test(previous.text.trim())) {
      const said = oneLine(previous.text)
      if (said.endsWith('?')) return { kind: 'question', summary: said }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// The refresh
// ---------------------------------------------------------------------------

type Verdict = { lastActivityAt: string; item: NeedsInputItem | null }
// A cache per idle session, keyed by its last activity: an unchanged session is
// not read again. Module state: a reload simply recomputes.
const verdicts = new Map<string, Verdict>()
// For a running session: which tool call has been pending, and since when.
const pending = new Map<string, { tool: string; since: number }>()
// A tool call pending this long in a running session is taken for a prompt.
const PENDING_MS = 60_000
let isRefreshing = false
let knownIds: Set<string> | null = null

type Options = { intervalMs: number; maxSessions: number; maxAgeMs: number; lang: Lang; debugFile: string }

async function writeDebug($: EngineInterface, options: Options, record: unknown): Promise<void> {
  if (options.debugFile === '') return
  try {
    await $.fs.write(options.debugFile, JSON.stringify(record, null, 2))
  } catch {
    // troubleshooting only: never let it break a refresh
  }
}

async function refresh($: EngineInterface, options: Options, isAsked = false): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  const words = WORDS[options.lang]
  try {
    await update($, snapshot, snap => ({ ...snap, isChecking: true }))
    const now = await $.clock.now()
    const rows = await listSessions($, options.maxSessions)
    const items: NeedsInputItem[] = []
    let checked = 0
    for (const row of rows) {
      if (row.isArchived) continue
      const isRunning = row.isRunning === true
      const lastActivityAt = row.lastActivityAt ?? ''
      const age = lastActivityAt ? now - Date.parse(lastActivityAt) : Infinity
      if (!isRunning && !(age < options.maxAgeMs)) continue
      checked += 1
      const cached = verdicts.get(row.sessionId)
      let item: NeedsInputItem | null
      if (!isRunning && cached && cached.lastActivityAt === lastActivityAt) {
        item = cached.item
      } else {
        const result = await $.mcp.call(SERVER, 'list_events', { session_id: row.sessionId, limit: 8 })
        let need = result.isError ? null : deriveNeed(textOf(result), isRunning)
        if (need?.pendingTool !== undefined && isRunning) {
          // A running session's pending call counts once it has stayed pending.
          const seen = pending.get(row.sessionId)
          const since = seen && seen.tool === need.pendingTool ? seen.since : now
          pending.set(row.sessionId, { tool: need.pendingTool, since })
          if (now - since < PENDING_MS) need = null
        } else {
          pending.delete(row.sessionId)
        }
        item = need
          ? {
              sessionId: row.sessionId,
              title: row.title ?? row.sessionId,
              summary: need.summary,
              kind: need.kind,
              since: lastActivityAt || new Date(now).toISOString(),
              link: row.link ?? `claude://claude.ai/epitaxy/${row.sessionId}`,
            }
          : null
        if (isRunning) verdicts.delete(row.sessionId)
        else verdicts.set(row.sessionId, { lastActivityAt, item })
      }
      if (item) items.push(item)
    }
    // Forget sessions that are no longer listed.
    const listed = new Set(rows.map(row => row.sessionId))
    for (const id of [...verdicts.keys()]) if (!listed.has(id)) verdicts.delete(id)
    for (const id of [...pending.keys()]) if (!listed.has(id)) pending.delete(id)

    items.sort((a, b) => Date.parse(b.since) - Date.parse(a.since))
    const finishedAt = await $.clock.now()
    await update($, snapshot, () => ({ items, checkedAt: finishedAt, checked, error: null, isChecking: false }))
    $.ui.status(words.status(items.length))
    await writeDebug($, options, { finishedAt: new Date(finishedAt).toISOString(), checked, rows: rows.length, items })

    const ids = new Set(items.map(item => item.sessionId))
    if (knownIds !== null) {
      const fresh = items.filter(item => !knownIds!.has(item.sessionId))
      if (fresh.length > 0) $.ui.toast(`${words.newItems(fresh.length)}: ${fresh.map(item => item.title).join(', ')}`)
    }
    knownIds = ids
    if (isAsked) $.ui.toast(words.refreshed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, snapshot, snap => ({ ...snap, error: message, isChecking: false }))
    await writeDebug($, options, { error: message, at: new Date().toISOString() })
  } finally {
    isRefreshing = false
  }
}

// ---------------------------------------------------------------------------
// Opening a session from the list
// ---------------------------------------------------------------------------

async function openSession($: EngineInterface, item: NeedsInputItem, lang: Lang): Promise<void> {
  const words = WORDS[lang]
  // 1. The app's own window tool: works for this session's own family.
  try {
    const result = await $.mcp.call(WINDOW_SERVER, 'open_session_in', { session_id: item.sessionId, target: 'focus' })
    const text = textOf(result)
    if (!result.isError && !/^refused|refused:|cannot|not started from/i.test(text)) {
      $.ui.toast(words.opened(item.title))
      return
    }
  } catch {
    // fall through
  }
  // 2. The app link through the host's protocol handler (CLI sessions).
  try {
    const run = await $.process.run(['cmd', '/c', 'start', '', item.link], { timeoutMs: 10_000 })
    if (run.exitCode === 0) {
      $.ui.toast(words.opened(item.title))
      return
    }
  } catch {
    // fall through
  }
  // 3. Hand the person the link.
  try {
    await $.ui.copy({ text: item.link })
  } catch {
    // nothing to do
  }
  $.ui.toast(words.copied, { timeoutMs: 8000 })
}

// ---------------------------------------------------------------------------
// The mod
// ---------------------------------------------------------------------------

function readOptions(raw: Readonly<Record<string, unknown>>): Options {
  const num = (key: string, fallback: number) => {
    const value = Number(raw[key])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  const lang: Lang = raw['language'] === 'en' ? 'en' : 'pl'
  const debugFile = typeof raw['debugFile'] === 'string' ? raw['debugFile'].trim() : ''
  return {
    intervalMs: Math.max(5, num('intervalSeconds', 20)) * 1000,
    maxSessions: Math.min(100, Math.max(1, Math.floor(num('maxSessions', 25)))),
    maxAgeMs: num('maxAgeDays', 14) * 86_400_000,
    lang,
    debugFile,
  }
}

function clock(ms: number): string {
  const date = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

async function openPane($: EngineInterface, lang: Lang, isAsked: boolean) {
  const title = WORDS[lang].title
  await $.store.delete(STORE_HIDDEN)
  return $.ui.open(isAsked ? { id: PANE, title, focus: true } : { id: PANE, title })
}

export const register: Register = (on, rawOptions) => {
  const options = readOptions(rawOptions)
  const words = WORDS[options.lang]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle the pane listing sessions waiting for your input (args: on, off, refresh)',
      argumentHint: '[on|off|refresh]',
    })
    const isHidden = (await $.store.get(STORE_HIDDEN)) === true
    if (!isHidden) void openPane($, options.lang, false)
    $.clock.after(1500, () => void refresh($, options))
    $.clock.every(options.intervalMs, () => void refresh($, options))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (arg === 'refresh') {
      if (!isUp) await openPane($, options.lang, true)
      void refresh($, options, true)
      return { text: words.checking }
    }
    if (arg === 'off' || (arg === '' && isUp)) {
      await $.ui.close({ id: PANE })
      await $.store.set(STORE_HIDDEN, true)
      return { text: words.paneClosed }
    }
    const opened = await openPane($, options.lang, true)
    void refresh($, options)
    return { text: opened.isPlaced ? words.paneOpened : `${words.paneOpened} (${opened.reason})` }
  })

  // The person closed the pane by hand: stay closed in later sessions too.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set(STORE_HIDDEN, true)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const now = Date.now()
    const columns = Math.max(20, e.props.bodyColumns || 40)

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text bold>
            {words.title}
            {snap.items.length > 0 ? ` (${snap.items.length})` : ''}
          </Text>
          <Button key="refresh" plain dimColor onPress={() => void refresh($, options, true)}>
            ↻ {words.refresh}
          </Button>
        </Box>

        {snap.error !== null && <Text color="red">{snap.error}</Text>}
        {snap.items.length === 0 && !snap.isChecking && <Text dimColor>{words.none}</Text>}
        {snap.items.length === 0 && snap.isChecking && <Text dimColor>{words.checking}</Text>}

        {snap.items.map(item => {
          const seconds = Math.max(0, Math.round((now - Date.parse(item.since)) / 1000))
          return (
            <Box key={`row-${item.sessionId}`} flexDirection="column">
              <Button key={`open-${item.sessionId}`} plain onPress={() => void openSession($, item, options.lang)}>
                {KIND_GLYPH[item.kind]} {item.title}
                <Text dimColor> · {words.ago(seconds)}</Text>
              </Button>
              <Box paddingLeft={3} width={columns}>
                <Text dimColor wrap="wrap">
                  {words.kinds[item.kind]}: {item.summary}
                </Text>
              </Box>
            </Box>
          )
        })}

        <Text dimColor size="footnote">
          {snap.isChecking ? words.checking : snap.checkedAt > 0 ? words.checked(snap.checked, clock(snap.checkedAt)) : ''}
        </Text>
      </Box>
    )
  })
}
