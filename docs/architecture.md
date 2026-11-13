# Architecture

Markdown tasks are authoritative for current state. A rebuildable in-memory index holds parsed tasks and journal records. Durable history is stored in `records/task-trace/events-<session-uuid>-<UTC-month>.jsonl` by default. The session UUID is the writer identity; a fresh UUID on load avoids simultaneous appenders sharing one file. This refines the concept's per-device filenames without requiring synchronized device settings.

Each schema-1 event contains event/task/writer IDs, `observedAt`, causal parent event IDs, kind and before/after task states. States contain only task text, checkbox character, note path, heading context and supported emoji dates. No full note snapshots are persisted. Unchanged state does not emit an event. Baseline/disappearance/reappearance are distinct from changes.

The scanner listens to vault create/modify/delete/rename events and serializes scans with a 1.5-second debounce. It reuses file-stamp caches and aborts a snapshot invalidated during a read. Journals are loaded before task comparison. Persistence must succeed before new observations enter the active history. Corrupt records, ID collisions or cyclic/cross-task ancestry pause recording. Missing parents and divergent heads pause the affected task; duplicate task IDs skip all corresponding tasks.

Shared-parent equivalent observations are collapsed only in the presentation. Raw records remain. Equivalent graph heads can become joint parents of a later observation. Divergent heads do not use wall-clock last-writer-wins. Sync can reorder notes and journals, and this model cannot reconstruct missing intermediate states or always identify a remote echo. Those limitations are visible in the README and live-test checklist.

ID insertion is an explicit synchronous editor operation on the cursor's task. It validates the full editor document against code/frontmatter examples and preserves a trailing block ID. It never rewrites a present Tasks ID. No background note writes are performed in this preview.

The runtime uses the public Obsidian API and Web Crypto, with no Node filesystem imports or network requests in the plugin bundle. Node-based build/deployment tools are separate. Mobile compatibility is an architectural target, not a completed test result.
