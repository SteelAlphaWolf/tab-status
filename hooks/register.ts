import type { Register, EngineInterface } from 'claude-code'

// Tab icons (hex code points, drawn by settitle.ps1). Highest priority first.
const WAITING = '270B' //   ✋ an Allow prompt or a question is waiting on you
const RUNNING = '26A1' //   ⚡ Claude is working (Claude's own spinner usually covers it)
const BACKGROUND = '23F3' // ⏳ reply done, background job or subagent still running
const FAILED = '274C' //    ❌ last reply ended in an error, a refusal or an interrupt
const STALE = '1F4A4' //    💤 cache expired: the next message re-reads the chat at full cost
const SOON = '1F7E1' //     🟡 cache expires soon: reply now and it's still cheap
const WARM = '1F7E2' //     🟢 idle, cache warm

const HOUR = 3_600_000
const FIVE_MIN = 300_000
const TICK = 60_000 // idle refresh
const WAIT_TICK = 3_000 // while waiting on you, re-assert over Claude's spinner
const FULL_AT = 80 // context % from which the brick shows
const RENAME_EVERY = 5 // replies between tab-name checks

const NAME_ASK = [
  'Name this chat for a terminal tab, judging by what it is about NOW (the latest messages weigh most).',
  'Answer with the name only: 2 to 4 plain words, Title Case, no quotes, no emoji, no punctuation at the end, under 32 characters.',
].join(' ')

type Timer = { cancel: () => void }

const st: {
  lastRequestAt: number
  ttlMs: number
  running: boolean
  waitingTool?: string
  failed: boolean
  backgroundCount: number
  ticker?: Timer
  waitTicker?: Timer
  pid?: string
  script?: string
  name?: string // the session title, once Claude Code has one
  aiName?: string // the name the mod picked from the latest content; wins over `name`
  replies: number
  naming: boolean
} = {
  lastRequestAt: 0,
  ttlMs: HOUR, // corrected from each response's cache write
  running: false,
  failed: false,
  backgroundCount: 0,
  replies: 0,
  naming: false,
}

/** Base64 of a UTF-8 string, so the chat name crosses the command line intact. */
function b64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function stamp(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`
}

async function setTab($: EngineInterface, icon: string, extra: string): Promise<void> {
  if (!st.pid || !st.script) {
    const env = await $.process.hookEnv()
    st.pid = env.CLAUDE_PID
    st.script = `${env.CLAUDE_PLUGIN_ROOT}/hooks/settitle.ps1`
  }
  if (!st.pid) return
  let full = ''
  try {
    const { context } = await $.session.usage()
    if ((context.percent ?? 0) >= FULL_AT) full = String(context.percent)
  } catch {
    // no reading: leave the brick off
  }
  try {
    await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', st.script, '-TargetPid', st.pid, '-Icon', icon, '-Extra', extra, '-Full', full, '-Name', (st.aiName ?? st.name) ? b64(st.aiName ?? st.name ?? '') : ''],
      { timeoutMs: 15_000 },
    )
  } catch (err) {
    $.ui.log(`tab-status: ${String(err)}`, { to: 'debug' })
  }
}

/** Picks the icon for the current state and draws it. */
async function refresh($: EngineInterface): Promise<void> {
  if (st.waitingTool) return setTab($, WAITING, '')
  if (st.running) return setTab($, RUNNING, '')
  if (st.backgroundCount > 0) return setTab($, BACKGROUND, '')
  if (st.failed) return setTab($, FAILED, '')
  if (!st.lastRequestAt) return setTab($, WARM, '')
  const left = st.lastRequestAt + st.ttlMs - (await $.clock.now())
  const soonAt = Math.min(10 * 60_000, st.ttlMs * 0.2) // 10 min on the 1-hour cache, 1 min on the 5-minute one
  if (left <= 0) return setTab($, STALE, stamp(-left))
  if (left <= soonAt) return setTab($, SOON, `${Math.ceil(left / 60_000)}m`)
  return setTab($, WARM, '')
}

/** Asks the model (over this chat's own cached transcript) for a fresh tab name. */
async function rename($: EngineInterface): Promise<void> {
  if (st.naming) return
  st.naming = true
  try {
    const sentAt = await $.clock.now()
    const reply = await $.model.fork({ prompt: NAME_ASK })
    if (!reply.isAnswered) return
    st.lastRequestAt = Math.max(st.lastRequestAt, sentAt) // reading the chat renews its cache
    const clean = (reply.text.trim().split(/\r?\n/)[0] ?? '').replace(/["'`*_#.]+/g, '').replace(/[^\p{L}\p{N} &+\-]/gu, '').trim().slice(0, 32)
    if (clean) {
      st.aiName = clean
      await refresh($)
    }
  } catch (err) {
    $.ui.log(`tab-status: rename failed: ${String(err)}`, { to: 'debug' })
  } finally {
    st.naming = false
  }
}

function startIdleTicker($: EngineInterface, firstInMs: number): void {
  st.ticker?.cancel()
  $.clock.after(firstInMs, () => void refresh($))
  st.ticker = $.clock.every(TICK, () => void refresh($))
}

function startWaiting($: EngineInterface, tool: string): void {
  st.waitingTool = tool
  st.waitTicker?.cancel()
  void refresh($)
  st.waitTicker = $.clock.every(WAIT_TICK, () => void refresh($))
}

function stopWaiting($: EngineInterface): void {
  if (!st.waitingTool) return
  st.waitingTool = undefined
  st.waitTicker?.cancel()
  st.waitTicker = undefined
  void refresh($)
}

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      st.running = true
      st.failed = false
      st.ticker?.cancel()
      st.ticker = undefined
      void refresh($)
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const res = yield* next(e)
    if (e.agentId === undefined) {
      st.lastRequestAt = sentAt
      const u = res.usage
      if (u && (u.ephemeral_1h_input_tokens ?? 0) > 0) st.ttlMs = HOUR
      else if (u && (u.ephemeral_5m_input_tokens ?? 0) > 0) st.ttlMs = FIVE_MIN
    }
    return res
  })

  // ✋ An Allow prompt is about to show (no settings rule answered it).
  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    if (!r.decision) startWaiting($, e.tool_name)
    return r
  }).catch(($, e, next) => next(e))

  // ✋ Claude asked you a question; any tool finishing means the prompt was answered.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') startWaiting($, e.tool)
    try {
      return await next(e)
    } finally {
      if (st.waitingTool === e.tool) stopWaiting($)
    }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    stopWaiting($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // ⏳ Background work still in flight when Claude stops talking.
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    const tasks = e.background_tasks ?? []
    st.backgroundCount = tasks.filter(t => /running|pending/i.test(t.status)).length
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      st.running = false
      st.failed = e.reason !== 'answer'
      stopWaiting($)
      if (e.reason === 'answer') {
        st.replies++
        // Name the tab after the first reply (also the first after a resume or reload), then every 5.
        if (st.replies === 1 || st.replies % RENAME_EVERY === 0) void rename($)
      }
      // Let Claude write its own idle title first, then put our icon in front.
      startIdleTicker($, 1500)
    }
    return r
  })

  // The chat name: Claude Code's session title, handed to its classic hooks.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.session_title) st.name = e.session_title
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.session_title) st.name = e.session_title
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // Stop Claude Code drawing its own tab title (the spinning circle), so ours shows.
    const set = await $.env.set('CLAUDE_CODE_DISABLE_TERMINAL_TITLE', '1')
    if (set.deny) $.ui.log(`tab-status: could not switch off Claude's title: ${set.deny}`, { to: 'debug' })
    startIdleTicker($, 2000)
    return r
  })
}
