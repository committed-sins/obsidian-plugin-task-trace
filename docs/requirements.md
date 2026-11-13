# Requirements

Source: [Obsidian Plugins veröffentlichen](https://chatgpt.com/c/6af64aab-02c8-83ed-ba76-e97233511e85), concept of 2026-11-12. Final name confirmed as **Task Trace** on 2026-11-13. Repository: `committed-sins/obsidian-plugin-task-trace`; plugin ID: `task-trace`.

## Product direction

Track how often the same task is renamed, moved, rescheduled or otherwise changed, with before/after values and times in a dedicated history view and task context action. Keep normal Markdown tasks and the ordinary Obsidian Tasks workflow. Operate independently of other Committed Sins plugins, with desktop and mobile support.

Use native `🆔` IDs as the only visible identity. Preserve all existing IDs, including completed/cancelled tasks. Detect duplicate IDs across the tracked scope and warn; do not silently regenerate them. New recurring instances get independent identities. Series association is a later explicit model, never title matching.

History must synchronize with the vault, independently of settings sync. Prefer per-writer JSONL records in configurable `records/task-trace`; do not store full note bodies. Retain events when the task disappears. Distinguish observed time from actual edit time; never invent transitions or timestamps for missed edits.

Use official Tasks APIs when suitable and available. No internal patches or Tasks-dialog manipulation. A command and editor context action are the initial history entry points; direct rendered-task/menu extensions require an appropriate supported upstream API.

## Preview boundary

The implementation records saved tasks already carrying one valid ID, offers explicit ID assignment, a timeline and counts, and persists per-session/month journals. It detects duplicate IDs, incomplete ancestry and divergent heads, and refuses malformed journals. Full Tasks syntax/global-filter behavior, automatic assignment, series linking and conflict resolution are not implemented.

## Decisions still to validate

- Automatic assignment must support all tracked tasks, selected scope and manual-only use. The earlier conversation proposed automatic IDs by default but did not settle the scope/write-safety policy. The preview starts manual-only.
- Safe ID writes need active/multiple editor, normal Tasks-dialog, sync and undo tests before automation.
- Cross-device observation deduplication is conservative, not an exactly-once guarantee. Logs can arrive after notes; branches must remain visible and recoverable.
- A configurable hidden settings-directory location was discussed. The preview requires a visible vault folder to make the synchronization requirement explicit.
- No release or directory submission is authorized by the initial setup request.
