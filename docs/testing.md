# Testing

`npm ci && npm run check` checks types, builds the browser bundle and runs synthetic core/scanner/deployment tests. These tests do not establish live Obsidian behavior. Test deployment preserves settings and activation; enable/reload the plugin manually in the selected test vault.

## Desktop smoke test

1. Create `- [ ] Task Trace test` in a disposable note. Assign an ID through the command. Confirm cursor, text, dependencies, undo and trailing block ID are preserved.
2. Save and scan for a baseline. Rename, change due/scheduled/start dates in the normal Tasks dialog and toggle status. Save between actions and check the timeline and counts.
3. Move the same ID to another file/heading. Confirm identity survives. Moving through multiple saves can produce disappearance/reappearance.
4. Close, cancel, reopen and delete the task. Check that history remains; deletion must not be reported as known completion. Repeat with `🏁 delete`.
5. Duplicate a task ID. Confirm warning and paused tracking for that ID; remove the duplicate and check recovery.
6. Pause recording, edit and resume. Confirm only observed combined changes are recorded. Try exclusions.

## Recovery and sync

Use disposable copies and retain backups of all journals. Close/reopen Obsidian, verify a new writer file is used and old history is loaded. Truncate a copied journal and verify writes pause without replacing it; restore it before continuing. Remove a journal while running and confirm recording pauses.

Synchronize notes **and** `records/task-trace` with Android. Test notes-before-journals and journals-before-notes arrival, concurrent offline edits, equivalent/divergent branches, duplicate IDs and app interruption during a write. Verify incomplete ancestry is held and divergent branches are not silently resolved. Do not claim exactly-once cross-device counting from a simple two-device smoke test.

## Performance and mobile

Measure startup reads, edit latency and memory in a representative large test vault. Verify Android Web Crypto support, context commands, timeline layout, background/resume and sync behavior. Test multiple editors and simultaneous vault instances. No live test has been performed by the initial setup workflow.
