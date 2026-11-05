import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { LocalItem, NeedsInputItem, NeedsInputKind, NeedsInputSnapshot } from '../types'

// ---------------------------------------------------------------------------
// desktop-sidebar-topics: a pane with two sections.
//
// 1. This conversation: the questions the assistant asked since the person's
//    last prompt (plain questions, AskUserQuestion prompts, a wrap-up's ask),
//    read from `$.session.messages()`. A click quotes the question into the
//    prompt box; a tick dismisses it.
// 2. Other sessions: the sessions of this app that wait for the person, read
//    from the app's session-management MCP server (`ccd_session_mgmt`):
//    `list_sessions` for the rows, `list_events` for each transcript's tail.
//
// Nothing is invented: a row appears only when the transcript says so.
// ---------------------------------------------------------------------------

const PANE = 'sidebar-topics'
const COMMAND = 'sidebar-topics'
const SERVER = 'ccd_session_mgmt'
const WINDOW_SERVER = 'ccd_window'
const STORE_HIDDEN = 'hidden'

const EMPTY: NeedsInputSnapshot = {
  local: [],
  items: [],
  checkedAt: 0,
  checked: 0,
  error: null,
  isChecking: false,
}

// Change the tag when the snapshot's fields change: an older stored value is
// then read as EMPTY instead of crashing the drawing.
const snapshot = atom({ plugin: 'desktop-sidebar-topics', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-2',
})
const dismissed = atom({ plugin: 'desktop-sidebar-topics', key: 'dismissed' } as const, [] as string[], {
  shape: 'dismissed-1',
})

type Lang = 'pl' | 'en'

const WORDS = {
  pl: {
    title: 'Czeka na Ciebie',
    thisSession: 'Ta rozmowa',
    others: 'Inne sesje',
    noneLocal: 'Brak otwartych pytań w tej rozmowie.',
    noneOthers: 'Żadna inna sesja nie czeka na odpowiedź.',
    checking: 'Sprawdzam sesje…',
    checked: (n: number, at: string) => `sprawdzono ${n} sesji o ${at}`,
    refresh: 'Odśwież',
    done: 'załatwione',
    kinds: {
      question: 'pytanie',
      choice: 'wybór opcji',
      approval: 'zgoda na narzędzie',
      decision: 'decyzja',
    } as Record<NeedsInputKind, string>,
    quoted: 'Pytanie wstawione do pola odpowiedzi.',
    quoteFailed: 'Nie mogę wstawić do pola; pytanie skopiowane do schowka.',
    opened: (t: string) => `Otwieram: ${t}`,
    copied: 'Nie mogę przełączyć sesji z moda. Link skopiowany do schowka; otwórz sesję z paska bocznego lub wklej link w przeglądarce.',
    newItems: (n: number) => (n === 1 ? '1 sesja czeka na Twoją odpowiedź' : `${n} sesje czekają na Twoją odpowiedź`),
    paneOpened: 'Panel „Czeka na Ciebie” otwarty.',
    paneClosed: 'Panel „Czeka na Ciebie” zamknięty.',
    refreshed: 'Lista odświeżona.',
    status: (local: number, others: number) => {
      const parts: string[] = []
      if (local > 0) parts.push(`${local} tu`)
      if (others > 0) parts.push(`${others} w innych sesjach`)
      return parts.length === 0 ? undefined : `⏳ czeka: ${parts.join(', ')}`
    },
    ago: (s: number) => (s < 60 ? 'przed chwilą' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`),
  },
  en: {
    title: 'Needs your input',
    thisSession: 'This conversation',
    others: 'Other sessions',
    noneLocal: 'No open questions in this conversation.',
    noneOthers: 'No other session is waiting for your answer.',
    checking: 'Checking sessions…',
    checked: (n: number, at: string) => `checked ${n} sessions at ${at}`,
    refresh: 'Refresh',
    done: 'done',
    kinds: {
      question: 'question',
      choice: 'choice to make',
      approval: 'tool approval',
      decision: 'decision',
    } as Record<NeedsInputKind, string>,
    quoted: 'Question quoted into the prompt box.',
    quoteFailed: 'Could not fill the prompt box; question copied to the clipboard.',
    opened: (t: string) => `Opening: ${t}`,
    copied: 'The mod cannot switch sessions on this surface. Link copied to the clipboard; open the session from the sidebar or paste the link in a browser.',
    newItems: (n: number) => (n === 1 ? '1 session waits for your answer' : `${n} sessions wait for your answer`),
    paneOpened: 'Sidebar-topics pane opened.',
    paneClosed: 'Sidebar-topics pane closed.',
    refreshed: 'List refreshed.',
    status: (local: number, others: number) => {
      const parts: string[] = []
      if (local > 0) parts.push(`${local} here`)
      if (others > 0) parts.push(`${others} in other sessions`)
      return parts.length === 0 ? undefined : `⏳ waiting: ${parts.join(', ')}`
    },
    ago: (s: number) => (s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`),
  },
} as const

const KIND_GLYPH: Record<NeedsInputKind, string> = {
  question: '❓',
  choice: '☑',
  approval: '🔒',
  decision: '⚖',
}

// ---------------------------------------------------------------------------
// Section 1: this conversation's open questions
// ---------------------------------------------------------------------------

function cleanLine(raw: string): string {
  return raw
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/, '')
    .trim()
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/** The questions in an assistant message's text: lines ending with `?`. */
function questionsIn(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = cleanLine(raw)
    if (!line.endsWith('?')) continue
    // Of a line with several sentences, the question is the last one.
    const sentences = line.split(/(?<=[.!?])\s+/)
    const question = sentences.filter(s => s.endsWith('?')).pop() ?? line
    if (question.length >= 8) out.push(cut(question, 160))
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** The open questions of this conversation: asked since the person's last prompt. */
function collectLocal(rows: readonly SessionMessage[]): LocalItem[] {
  let lastPrompt = -1
  rows.forEach((row, index) => {
    if (row.role === 'user' && row.text.trim() !== '') lastPrompt = index
  })
  const items: LocalItem[] = []
  for (let index = lastPrompt + 1; index < rows.length; index += 1) {
    const row = rows[index]!
    if (row.role !== 'assistant') continue
    for (const use of row.toolUses) {
      const input = asRecord(use.input)
      if (use.tool === 'AskUserQuestion' && use.text === undefined && use.result === undefined) {
        const questions = Array.isArray(input['questions']) ? (input['questions'] as unknown[]) : []
        for (const one of questions) {
          const question = asRecord(one)['question']
          if (typeof question === 'string' && question.trim() !== '') {
            items.push({ key: `${index}:${use.tool_use_id}:${question}`, question: cut(question.trim(), 160), kind: 'choice', messageIndex: index })
          }
        }
      } else if (use.tool.endsWith('__wrap_up')) {
        const ask = input['ask']
        if (typeof ask === 'string' && ask.trim() !== '') {
          items.push({ key: `${index}:${use.tool_use_id}`, question: cut(ask.trim(), 160), kind: 'decision', messageIndex: index })
        }
      }
    }
    for (const question of questionsIn(row.text)) {
      items.push({ key: `${index}:${question}`, question, kind: 'question', messageIndex: index })
    }
  }
  // The same question asked twice (a wrap-up's ask repeated in the text) shows once.
  const seen = new Set<string>()
  return items.filter(item => {
    const norm = item.question.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(norm)) return false
    seen.add(norm)
    return true
  })
}

async function readLocal($: EngineInterface): Promise<LocalItem[]> {
  const rows = await $.session.messages()
  return Array.isArray(rows) ? collectLocal(rows) : []
}

async function quoteIntoPrompt($: EngineInterface, item: LocalItem, lang: Lang): Promise<void> {
  const words = WORDS[lang]
  const text = `> ${item.question}\n`
  try {
    await $.prompt.fill({ text, mode: 'insert' })
    $.ui.toast(words.quoted)
    return
  } catch {
    // fall through
  }
  try {
    await $.ui.copy({ text: item.question })
  } catch {
    // nothing to do
  }
  $.ui.toast(words.quoteFailed)
}

// ---------------------------------------------------------------------------
// Section 2: other sessions, read from the app's session service
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
    .map(cleanLine)
    .filter(line => line.length > 0)
  // The question is usually the last line; prefer it when it is one.
  const last = lines[lines.length - 1] ?? ''
  const pick = last.endsWith('?') ? last : lines.find(line => line.endsWith('?')) ?? last
  return cut(pick, max)
}

type Need = { kind: NeedsInputKind; summary: string; pendingTool?: string }

/**
 * What another session's transcript tail says it is waiting for, or null.
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
    const previous = entries[entries.length - 2]
    if (previous && previous.tag === 'assistant' && !CALLED.test(previous.text.trim())) {
      const said = oneLine(previous.text)
      if (said.endsWith('?')) return { kind: 'question', summary: said }
    }
  }

  return null
}

type Verdict = { lastActivityAt: string; item: NeedsInputItem | null }
// A cache per idle session, keyed by its last activity: an unchanged session is
// not read again. Module state: a reload simply recomputes.
const verdicts = new Map<string, Verdict>()
// For a running session: which tool call has been pending, and since when.
const pending = new Map<string, { tool: string; since: number }>()
// A tool call pending this long in a running session is taken for a prompt.
const PENDING_MS = 60_000

async function collectOthers($: EngineInterface, options: Options, now: number): Promise<{ items: NeedsInputItem[]; checked: number; rows: number }> {
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
  const listed = new Set(rows.map(row => row.sessionId))
  for (const id of [...verdicts.keys()]) if (!listed.has(id)) verdicts.delete(id)
  for (const id of [...pending.keys()]) if (!listed.has(id)) pending.delete(id)
  items.sort((a, b) => Date.parse(b.since) - Date.parse(a.since))
  return { items, checked, rows: rows.length }
}

async function openSession($: EngineInterface, item: NeedsInputItem, lang: Lang): Promise<void> {
  const words = WORDS[lang]
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
  try {
    const run = await $.process.run(['cmd', '/c', 'start', '', item.link], { timeoutMs: 10_000 })
    if (run.exitCode === 0) {
      $.ui.toast(words.opened(item.title))
      return
    }
  } catch {
    // fall through
  }
  try {
    await $.ui.copy({ text: item.link })
  } catch {
    // nothing to do
  }
  $.ui.toast(words.copied, { timeoutMs: 8000 })
}

// ---------------------------------------------------------------------------
// The refresh
// ---------------------------------------------------------------------------

type Options = { intervalMs: number; maxSessions: number; maxAgeMs: number; lang: Lang; debugFile: string }

async function writeDebug($: EngineInterface, options: Options, record: unknown): Promise<void> {
  if (options.debugFile === '') return
  try {
    await $.fs.write(options.debugFile, JSON.stringify(record, null, 2))
  } catch {
    // troubleshooting only: never let it break a refresh
  }
}

let isRefreshing = false
let knownIds: Set<string> | null = null

/** Re-reads this conversation only: cheap, run after every turn. */
async function refreshLocal($: EngineInterface, options: Options): Promise<void> {
  try {
    const local = await readLocal($)
    const snap = await update($, snapshot, snap => ({ ...snap, local }))
    $.ui.status(WORDS[options.lang].status(local.length, snap.items.length))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, snapshot, snap => ({ ...snap, error: message }))
  }
}

/** Re-reads both sections. */
async function refresh($: EngineInterface, options: Options, isAsked = false): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  const words = WORDS[options.lang]
  try {
    await update($, snapshot, snap => ({ ...snap, isChecking: true }))
    const now = await $.clock.now()
    const local = await readLocal($)
    const others = await collectOthers($, options, now)
    const finishedAt = await $.clock.now()
    await update($, snapshot, () => ({
      local,
      items: others.items,
      checkedAt: finishedAt,
      checked: others.checked,
      error: null,
      isChecking: false,
    }))
    $.ui.status(words.status(local.length, others.items.length))
    await writeDebug($, options, { finishedAt: new Date(finishedAt).toISOString(), local, checked: others.checked, rows: others.rows, items: others.items })

    const ids = new Set(others.items.map(item => item.sessionId))
    if (knownIds !== null) {
      const fresh = others.items.filter(item => !knownIds!.has(item.sessionId))
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
      description: 'Toggle the pane listing questions waiting for your input (args: on, off, refresh)',
      argumentHint: '[on|off|refresh]',
    })
    const isHidden = (await $.store.get(STORE_HIDDEN)) === true
    if (!isHidden) void openPane($, options.lang, false)
    $.clock.after(1500, () => void refresh($, options))
    $.clock.every(options.intervalMs, () => void refresh($, options))

    return next(e)
  })

  // This conversation's section follows the turns closely.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) $.clock.after(500, () => void refreshLocal($, options))
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(1000, () => void refreshLocal($, options))
    return result
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
    const ticked = new Set(await read($, dismissed))
    const local = snap.local.filter(item => !ticked.has(item.key))
    const now = Date.now()
    const columns = Math.max(20, e.props.bodyColumns || 40)

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text bold>
            {words.title}
            {local.length + snap.items.length > 0 ? ` (${local.length + snap.items.length})` : ''}
          </Text>
          <Button key="refresh" plain dimColor onPress={() => void refresh($, options, true)}>
            ↻ {words.refresh}
          </Button>
        </Box>

        {snap.error !== null && <Text color="red">{snap.error}</Text>}

        <Box flexDirection="column">
          <Text bold size="footnote">
            {words.thisSession}
            {local.length > 0 ? ` (${local.length})` : ''}
          </Text>
          {local.length === 0 && <Text dimColor>{words.noneLocal}</Text>}
          {local.map(item => (
            <Box key={`local-${item.key}`} flexDirection="column">
              <Button key={`quote-${item.key}`} plain onPress={() => void quoteIntoPrompt($, item, options.lang)}>
                {KIND_GLYPH[item.kind]} {item.question}
              </Button>
              <Box paddingLeft={3} width={columns}>
                <Text dimColor>{words.kinds[item.kind]} · </Text>
                <Button key={`done-${item.key}`} plain dimColor onPress={() => void update($, dismissed, keys => [...keys, item.key].slice(-500))}>
                  ✓ {words.done}
                </Button>
              </Box>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold size="footnote">
            {words.others}
            {snap.items.length > 0 ? ` (${snap.items.length})` : ''}
          </Text>
          {snap.items.length === 0 && !snap.isChecking && <Text dimColor>{words.noneOthers}</Text>}
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
        </Box>

        <Text dimColor size="footnote">
          {snap.isChecking ? words.checking : snap.checkedAt > 0 ? words.checked(snap.checked, clock(snap.checkedAt)) : ''}
        </Text>
      </Box>
    )
  })
}
