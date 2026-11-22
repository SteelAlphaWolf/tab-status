# tab-status

A Claude Code mod that puts a status icon on your Windows Terminal tab, so with several Claude tabs open you can see at a glance which one needs you, which is working, and which would cost tokens to pick back up.

After the first reply, and then every 5 replies, the mod gives the tab a fresh 2-4 word name based on what the chat is about now (one short question over the chat's own cached history, so it costs little). Until then it shows "Claude Code" (or your chat title if you renamed the chat), never the shell's default "Windows PowerShell".

| Icon | Meaning |
| --- | --- |
| ✋ | Waiting on you: an Allow prompt or a question from Claude |
| ⚡ | Running (Claude's own spinner usually shows here while it works) |
| ⏳ | Reply done, but a background job or subagent is still running |
| ❌ | The last reply ended in an error, a refusal or an interrupt |
| 🟢 | Idle, prompt cache still warm: the next message is cheap |
| 🟡 8m | Cache expires in 8 minutes: reply now and it's still cheap |
| 💤 1h05m | Cache expired 1h05m ago: the next message re-reads the whole chat at full price |
| 🧱 85% | Added to any of the above when the chat is 80%+ full (compaction is close) |

The stale timer follows the cache lifetime each reply actually got (1 hour or 5 minutes), so it doesn't guess.

## Install

In Claude Code:

```
/plugin install tab-status --marketplace SteelAlphaWolf/tab-status
```

Then turn off Claude Code's own tab title (its spinning circle would otherwise cover the ⚡ icon). Add this to `~/.claude/settings.json`:

```json
"env": { "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1" }
```

(If you already have an `"env"` block, add the line inside it.) Then restart Claude Code. Tabs opened after that get the icons and names.

## Requirements

- Windows with Windows Terminal (the mod sets the console title through the Windows console API; other terminals and macOS/Linux are not supported yet).
- Windows PowerShell 5.1 (built in).

## How it works

Claude Code mods have no call for the tab title, so `hooks/settitle.ps1` attaches to Claude Code's console (by `CLAUDE_PID`), reads the current title, strips any old icon, and sets the new one. The mod (`hooks/register.ts`) watches turns, permission prompts, questions, background tasks, cache lifetimes and context use, and refreshes the icon after each reply and once a minute while idle.
