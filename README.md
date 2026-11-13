# Task Trace

Follow the life of a task: changes, rescheduling, status transitions and moves, using ordinary Markdown and Obsidian Tasks-compatible `🆔` IDs.

**Status: development preview 0.1.0.** No public release or Community Plugins submission yet. Desktop and Android are targets; live behavior is not verified.

## Preview features

- Records saved tasks with one `🆔` ID, including custom checkbox statuses.
- Shows a sidebar timeline, observed-change count and rescheduling count.
- Detects text, status, file, heading, due/scheduled/start/done/cancelled-date changes.
- Adds a missing ID through a command or editor context menu; preserves existing IDs and block references.
- Retains history when a task disappears; does not guess whether it was deleted or completed with `🏁 delete`.
- Stores synchronized JSONL journals under `records/task-trace`, with a separate writer per plugin session and month.
- Skips duplicate task IDs and divergent history branches; pauses on corrupt journals.

Task Trace does not require Tasks to be installed, does not patch its internals and does not change its dialog. The preview recognizes emoji-format task metadata, not the complete Tasks parser or its global-filter semantics. Recurrence/priority/dependency changes currently appear as changes to the remaining task text. Unidentified tasks are ignored until given an ID.

## Try it

1. Build and deploy into a **test vault**, then enable/reload Task Trace there.
2. Put the cursor on a Markdown task and run **Task Trace: Assign ID to task at cursor**, or use an existing `🆔` ID.
3. Save the note. Wait for the initial baseline, or run **Scan for task changes**.
4. Edit its name, scheduled date or status through your usual workflow; save and wait briefly.
5. Run **Show history of task at cursor**. The ribbon also opens the history sidebar.

The first observation is a baseline, not a claimed creation event. ID insertion itself is not counted as a task change. Journals contain task text and note paths, not full notes; treat them as sensitive vault content.

## Build and deployment

Requires Node 22+ and npm.

```sh
npm ci
npm run check
```

Copy `.env.example` to ignored `.env.local` and set `OBSIDIAN_VAULT` to your test vault. Then run `npm run deploy`. Deployment copies only `main.js`, `manifest.json` and `styles.css` from `dist/`; it preserves plugin settings, activation, notes and workspace state. Enable/reload manually.

## Synchronization and limits

Sync the journal folder along with Markdown notes on every device. Plugin-settings sync alone is insufficient. Each session writes a separate append-only file; raw events are never rewritten by the plugin. New sessions use new writer UUIDs, avoiding a shared append target even with multiple running vault instances.

Event IDs deduplicate imported records. Causal parents connect observations; equivalent concurrent observations sharing parents collapse in the view. Missing ancestry and divergent heads pause the affected task. Journal corruption pauses recording globally; restore/review the original data rather than deleting it blindly.

This is an **observation history**, not a complete audit trail. Offline/intermediate edits can be missed. Notes and journals can arrive in either order during sync, producing additional observations; complete cross-device semantic deduplication and automatic conflict resolution are not promised. Disappearance may mean deletion, ID removal or an unsupported representation. Moving a task between files in separate saves may produce disappearance/reappearance rather than one move.

The scanner debounces vault events by 1.5 seconds and caches parsed notes and journals by file stamps. The initial scan reads in-scope Markdown and journals. No editor keystroke interception, background polling or network service is used. Large-vault performance still needs measurement.

Defaults exclude `templates`, `archives`, `scripts`, `libraries` and `inbound`; exclusions are configurable. Tasks moved outside the tracked scope retain their existing history. Pause recording before moving the journal folder, move all journals yourself, change the path, then reload the plugin. Hidden/outside-vault paths are intentionally unsupported in the preview.

## Next steps

Safe automatic ID assignment with scope controls, recurring-series associations, conflict review/recovery tooling, history filters/export, deeper public Tasks API integration and desktop/Android validation are tracked in [the roadmap](docs/roadmap.md). See [requirements](docs/requirements.md), [architecture](docs/architecture.md) and [manual testing](docs/testing.md).

MIT · Michael J. Stallinger / [Committed Sins](https://github.com/committed-sins)
