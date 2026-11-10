# desktop-sidebar-topics — panel „Czeka na Ciebie” / "Needs your input" pane

A mod for the Claude Desktop app (Code tab) that adds a pane beside the chat
listing the sessions that are currently waiting for **your** answer, so you can
work through them one by one instead of hunting through the sidebar.

Mod do aplikacji Claude Desktop (zakładka Code): panel obok czatu z listą sesji,
które czekają na Twoją odpowiedź.

## Install

In the Claude Desktop app (Code tab): click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `qmw/claude-desktop-sidebar-topics`, then
**Add plugin** and pick `desktop-sidebar-topics`.

At the prompt of a terminal `claude` session:

```
/plugin install desktop-sidebar-topics --marketplace qmw/claude-desktop-sidebar-topics
```

From a shell:

```
claude plugin install desktop-sidebar-topics --marketplace qmw/claude-desktop-sidebar-topics
```

Answer `y` to add the marketplace, then choose the user scope. The mod is active
in that session right away and in every session started afterwards. Installed
this way, nothing below under "Enable, disable, uninstall" is needed; disable or
remove it from the same Plugins menu (or `claude plugin uninstall desktop-sidebar-topics`).

## What it shows

The pane has two sections.

**This conversation (Ta rozmowa)**, on top: the questions the assistant asked
you since your last prompt in the session you are looking at, read from the
session's own transcript:

| Glyph | Kind (pl / en)          | Derived from                                              |
| ----- | ----------------------- | --------------------------------------------------------- |
| ❓    | pytanie / question      | a line of the assistant's reply that ends with `?`        |
| ☑    | wybór opcji / choice    | an `AskUserQuestion` prompt that has not been answered    |
| ⚖    | decyzja / decision      | the question in the turn's wrap-up box                    |
| ✋    | prośba / request        | a line asking for your input without a question mark ("Next from you: …", "let me know", "daj znać", "potwierdź") |

Click a question to quote it into the prompt box and answer it; tick ✓ to
dismiss one without answering. The section refreshes after every turn and
prompt, and empties once you send your next message (the questions are then
taken as answered).

**Other sessions (Inne sesje)**, below: every 20 seconds (configurable) the mod
asks the app's own session service for your recent sessions and reads the tail
of each session's transcript. A session is listed when that tail ends in:

| Glyph | Kind (pl / en)                | Derived from                                                  |
| ----- | ----------------------------- | ------------------------------------------------------------- |
| ❓    | pytanie / question            | the session's last message is a question (ends with `?`)      |
| ☑    | wybór opcji / choice          | an `AskUserQuestion` prompt that has not been answered        |
| 🔒    | zgoda na narzędzie / approval | a tool call that never got its result (a permission prompt)   |

Each row shows the session title, how long ago it stopped, the kind of input
needed and the question itself. Every call to the session service gets 15 s;
a session whose transcript does not arrive in time is skipped for that refresh
and counted in a yellow line, and the footer shows progress while checking. The app reports a session blocked at a prompt
as "running", so running sessions are checked too: a pending `AskUserQuestion`
counts at once, any other pending tool call only after it has stayed pending
for a minute (a tool may simply be executing). Archived sessions are never
listed. Once you answer, the session stops matching and the row disappears on
the next refresh. New rows raise a toast, and the status line under the prompt
shows how many questions wait here and in other sessions.

**Threads (Wątki)**, at the bottom: every question in either section has a
💬 "wątek" link that opens a side thread on that one topic, a separate
conversation you discuss it in.

- In the desktop app a thread is a session of its own. The app starts a
  session at once only on words you typed, so the click puts a "New task" card
  into the conversation; click the card and the thread starts, nested under the
  current session in the sidebar. It opens with the question and the message
  that asked it as context, restates the topic and waits for you.
- In a terminal session, where the app's session service is absent, the thread
  is a subagent and the main view switches to it; its agent type is hidden
  from the model, so Claude never delegates to it on its own.

When you have decided, the thread ends with one line starting with
`USTALENIE:` (or `DECISION:`) that you can paste into the main conversation.
The Threads section lists each thread with its state ("kliknij kartę w
rozmowie" until you start the card); clicking a started thread shows it, ✕
removes it from the list. A started thread is found by its session title, on
the next refresh.

## Using it

- The pane opens by itself when a session starts (unless you closed it by hand
  earlier; that choice is remembered).
- `/sidebar-topics` toggles the pane. `/sidebar-topics on`, `/sidebar-topics off` and
  `/sidebar-topics refresh` do what they say.
- Click a row to open that session. In the desktop app this works directly only
  for sessions started from the current one; for any other session the mod
  copies the session's `claude://` link to the clipboard and shows a toast, and
  you open the session from the sidebar (an app limitation, see below).
- The ↻ button refreshes at once.

Options (in the app's config menu under the plugin, or `pluginConfigs` in
`~/.claude/settings.json`): `intervalSeconds` (20), `maxSessions` (25),
`maxAgeDays` (14), `language` (`pl` or `en`), `debugFile` (empty; set a path to
have each refresh write there what the pane lists, plus the first characters of
the last few transcript rows, and each thread click to a `-actions.txt` file
beside it; for troubleshooting only).

## Enable, disable, uninstall (from a local folder, without the marketplace)

A copy of this folder (say `C:\Users\<you>\.claude\mods\desktop-sidebar-topics`) is loaded
through `CLAUDE_CODE_PLUGIN_DIRS`, read from the `env` block of
`C:\Users\<you>\.claude\settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<you>\\.claude\\mods\\desktop-sidebar-topics"
  }
}
```

- **Enable**: run `install.ps1` from the mod folder (it adds the entry above,
  merging with any existing settings), or add the entry by hand. Every session
  started afterwards loads the mod; sessions already open do not.
  Several folders are separated with `;`.

  ```powershell
  powershell -ExecutionPolicy Bypass -File "$HOME\.claude\mods\desktop-sidebar-topics\install.ps1"
  ```

- **Hide temporarily**: run `/sidebar-topics off` in a session (remembered across
  sessions until `/sidebar-topics on`), or close the pane with its close mark.
- **Disable**: run `uninstall.ps1` (removes the settings entry and the mod's
  stored options, keeps the files), or remove the folder from
  `CLAUDE_CODE_PLUGIN_DIRS` by hand.
- **Uninstall**: `uninstall.ps1 -RemoveFiles`, or do the above and delete the
  mod folder.

  ```powershell
  powershell -ExecutionPolicy Bypass -File "$HOME\.claude\mods\desktop-sidebar-topics\uninstall.ps1" -RemoveFiles
  ```

A terminal session loads it the same way, or with
`claude --plugin-dir C:\Users\<you>\.claude\mods\desktop-sidebar-topics`.

## Files

- `.claude-plugin/plugin.json` — manifest and user options
- `hooks/hooks.json` — names the hooks module
- `hooks/register.tsx` — the mod: polling, the pane, the slash command
- `types/index.d.ts` — the state contract (`desktop-sidebar-topics.snapshot`, `.dismissed`, `.threads`)
- `install.ps1`, `uninstall.ps1` — enable / disable scripts (see above)
- `tsconfig.json` — extends the type files the engine lays in
  `.claude-plugin/types/` once the mod has loaded (for an editor or `tsc`)

## Known limits of the app's mod API

- The session list carries no "waiting for input" flag, so the kind of input is
  derived from the transcript's tail. A wrap-up question is recognised because
  the session's last message ends with a question mark; a session that stopped
  for any other reason without asking anything is not listed.
- Pending proposal cards ("New task" cards) are not exposed to mods, so they are
  not listed.
- A mod can focus only sessions started from the session it runs in; for other
  sessions it hands you the link.
