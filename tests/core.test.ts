import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addId, changed, heads, historyFor, journalFolder, mergeEvents, parseJournal, parseTasks, planEvents, uniqueTasks, type TaskState, type TraceEvent } from '../src/core';
import TaskTrace from '../src/main';
import { TFile, type App, type PluginManifest } from 'obsidian';

const state = (patch: Partial<TaskState> = {}): TaskState => ({ path: 'Projects.md', section: 'Work', status: ' ', text: 'Build plugin', due: '', scheduled: '', start: '', done: '', cancelled: '', ...patch });
let serial = 0;
const plan = (events: TraceEvent[], current = new Map([['abc123', state()]]), duplicates = new Set<string>()) => planEvents(events, current, duplicates, 'writer', '2026-11-13T08:00:00Z', () => `event-${++serial}`);

test('parses Tasks-compatible IDs, statuses, headings and emoji dates', () => {
  const found = parseTasks('# Work\r\n- [>] Build plugin 🆔 abc_123 📅 2026-11-20 ⏳ 2026-11-14\r\n', 'Projects.md');
  assert.equal(found.length, 1);
  assert.equal(found[0].state.text, 'Build plugin');
  assert.equal(found[0].state.status, '>');
  assert.equal(found[0].state.section, 'Work');
  assert.equal(found[0].state.due, '2026-11-20');
  assert.equal(found[0].state.scheduled, '2026-11-14');
  assert.equal(found[0].line, 1);
});
test('ignores YAML, fenced examples and missing IDs', () => {
  assert.equal(parseTasks('---\n- [ ] YAML 🆔 yaml\n---\n```md\n- [ ] code 🆔 code\n```\n~~~\n- [ ] code 🆔 tilde\n~~~\n- [ ] no id\n- [x] Real 🆔 real', 'a.md').length, 1);
});
test('supports nested and ordered task lists', () => {
  assert.equal(parseTasks('  - [ ] Nested 🆔 nested\n1. [-] Cancelled 🆔 cancelled', 'a.md').length, 2);
});
test('duplicate IDs across files skip all affected tasks', () => {
  const snapshot = uniqueTasks([...parseTasks('- [ ] One 🆔 abc123', 'a.md'), ...parseTasks('- [ ] Two 🆔 abc123', 'b.md')]);
  assert.equal(snapshot.tasks.size, 0);
  assert.ok(snapshot.duplicates.has('abc123'));
  const baseline = plan([]);
  assert.deepEqual(plan(baseline, snapshot.tasks, snapshot.duplicates), []);
});
test('first observation is a baseline, not an invented creation', () => {
  const events = plan([]);
  assert.equal(events[0].kind, 'baseline');
  assert.equal(events[0].before, null);
  assert.deepEqual(plan(events), []);
});
test('rename, path/section move, status and dates are independent differences', () => {
  const before = state(), after = state({ text: 'New title', path: 'Elsewhere.md', section: 'Later', status: 'x', due: '2026-11-20', scheduled: '2026-11-19', done: '2026-11-13' });
  assert.deepEqual(changed(before, after), ['path', 'section', 'status', 'text', 'due', 'scheduled', 'done']);
  const events = plan([]);
  assert.equal(plan(events, new Map([['abc123', after]]))[0].kind, 'change');
});
test('close, cancel and reopen retain the same identity', () => {
  const events = plan([]);
  for (const status of ['x', '-', ' ']) events.push(...plan(events, new Map([['abc123', state({ status })]])));
  assert.equal(events.length, 4);
  assert.ok(events.every(e => e.taskId === 'abc123'));
});
test('disappearance keeps history and does not claim completion', () => {
  const events = plan([]);
  const removed = plan(events, new Map());
  assert.equal(removed[0].kind, 'disappeared');
  assert.equal(removed[0].after, null);
  assert.equal(removed[0].before?.status, ' ');
  events.push(...removed);
  assert.deepEqual(plan(events, new Map()), []);
  assert.equal(plan(events)[0].kind, 'reappeared');
});
test('recurring task with a new ID gets an independent baseline', () => {
  const events = plan([]);
  const next = plan(events, new Map([['abc123', state({ status: 'x' })], ['new-id', state()]]));
  assert.equal(next.find(e => e.taskId === 'new-id')?.kind, 'baseline');
});
test('synced events already matching the note do not produce another observation', () => {
  const events = plan([]);
  events.push(...plan(events, new Map([['abc123', state({ due: '2026-11-20' })]])));
  assert.deepEqual(plan(events, new Map([['abc123', state({ due: '2026-11-20' })]])), []);
});
test('equivalent concurrent observations collapse in the view but remain in raw history', () => {
  const baseline = plan([]);
  const current = new Map([['abc123', state({ due: '2026-11-20' })]]);
  const events = [...baseline, ...plan(baseline, current), ...plan(baseline, current)];
  assert.equal(heads(events).length, 2);
  assert.equal(historyFor(events, 'abc123').length, 2);
  assert.deepEqual(plan(events, current), []);
  assert.equal(plan(events, new Map([['abc123', state({ due: '2026-11-21' })]]))[0].parents.length, 2);
});
test('divergent concurrent branches pause instead of choosing a last writer', () => {
  const baseline = plan([]);
  const branches = [...baseline, ...plan(baseline, new Map([['abc123', state({ text: 'A' })]])), ...plan(baseline, new Map([['abc123', state({ text: 'B' })]]))];
  assert.deepEqual(plan(branches), []);
});
test('incomplete sync ancestry pauses affected ID', () => {
  const event = plan([])[0]; event.parents = ['not-yet-synced'];
  assert.deepEqual(plan([event]), []);
});
test('journal import deduplicates IDs, rejects collisions, invalid and partial records', () => {
  const event = plan([])[0], encoded = JSON.stringify(event) + '\n';
  assert.deepEqual(parseJournal(encoded), [event]);
  assert.equal(mergeEvents([event, event]).length, 1);
  assert.throws(() => mergeEvents([event, { ...event, writer: 'other' }]));
  for (const bad of ['{', '{"schema":2}', JSON.stringify({ ...event, after: {} }), JSON.stringify({ ...event, parents: [1] })]) assert.throws(() => parseJournal(bad));
});
test('adding an ID preserves task metadata, dependencies and block links', () => {
  assert.equal(addId('- [ ] Task 📅 2026-11-20 ⛔ other ^block', 'new-id'), '- [ ] Task 📅 2026-11-20 ⛔ other 🆔 new-id ^block');
  assert.throws(() => addId('- [ ] Existing 🆔 abc123', 'new-id'));
  assert.throws(() => addId('Plain text', 'new-id'));
  assert.throws(() => addId('- [ ] Task', '../bad'));
});
test('journal folder rejects traversal, hidden paths and absolute paths', () => {
  assert.equal(journalFolder('records/task-trace/'), 'records/task-trace');
  for (const path of ['', '../notes', '/notes', 'C:/notes', 'records/../notes', '.obsidian/plugins', 'records//logs']) assert.throws(() => journalFolder(path));
});
test('multiple IDs pause, commented tasks are ignored', () => {
  assert.throws(() => parseTasks('- [ ] Task 🆔 one 🆔 two', 'a.md'));
  assert.equal(parseTasks('<!--\n- [ ] Example 🆔 example\n-->\n- [ ] Real 🆔 real', 'a.md').length, 1);
});
test('cross-task and cyclic journal ancestry are rejected', () => {
  const a = plan([])[0], b = { ...plan([])[0], taskId: 'other', parents: [a.eventId] };
  assert.throws(() => mergeEvents([a, b]));
  assert.throws(() => mergeEvents([{ ...a, parents: [a.eventId] }]));
});

function harness(initial: Record<string, string>) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: () => 0, clearTimeout: () => {} } });
  const files = new Map<string, TFile>(), contents = new Map<string, string>(), folders = new Map<string, { path: string }>();
  let clock = 0, failWrite = false, noteWrites = 0;
  const put = (path: string, text: string) => {
    const file = files.get(path) ?? new TFile();
    Object.assign(file, { path, extension: path.split('.').at(-1), stat: { mtime: ++clock, size: text.length, ctime: 0 } });
    files.set(path, file); contents.set(path, text); return file;
  };
  for (const [path, text] of Object.entries(initial)) put(path, text);
  const app = {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
      read: async (file: TFile) => contents.get(file.path)!,
      createFolder: async (path: string) => { folders.set(path, { path }); },
      create: async (path: string, text: string) => { if (failWrite) throw Error('Disk full'); if (path.endsWith('.md')) noteWrites++; return put(path, text); },
      append: async (file: TFile, text: string) => { if (failWrite) throw Error('Disk full'); if (file.path.endsWith('.md')) noteWrites++; put(file.path, contents.get(file.path)! + text); }
    }
  } as unknown as App;
  const plugin = new TaskTrace(app, {} as PluginManifest);
  return { plugin, files, contents, put, get noteWrites() { return noteWrites; }, setFail: (fail: boolean) => { failWrite = fail; } };
}
test('scanner records baselines and saved edits without writing notes', async () => {
  const h = harness({ 'Tasks.md': '- [ ] Task 🆔 tracked', 'templates/Template.md': '- [ ] Ignore 🆔 template' });
  await h.plugin.scan();
  assert.equal(h.plugin.events.length, 1);
  h.put('Tasks.md', '- [x] Task 🆔 tracked ✅ 2026-11-13');
  await h.plugin.scan();
  assert.equal(h.plugin.events.length, 2);
  assert.equal(h.plugin.events[1].kind, 'change');
  await h.plugin.scan();
  assert.equal(h.plugin.events.length, 2);
  assert.equal(h.noteWrites, 0);
});
test('scanner retries failed persistence without counting an unpersisted event', async () => {
  const h = harness({ 'Tasks.md': '- [ ] Task 🆔 tracked' });
  h.setFail(true); await h.plugin.scan();
  assert.equal(h.plugin.events.length, 0);
  assert.match(h.plugin.warnings[0], /Disk full/);
  h.setFail(false); await h.plugin.scan();
  assert.equal(h.plugin.events.length, 1);
});
test('corrupt journals pause recording and preserve original bytes', async () => {
  const path = 'records/task-trace/broken.jsonl';
  const h = harness({ 'Tasks.md': '- [ ] Task 🆔 tracked', [path]: '{broken' });
  await h.plugin.scan();
  assert.equal(h.plugin.events.length, 0);
  assert.equal(h.contents.get(path), '{broken');
  assert.equal(h.files.size, 2);
  assert.equal(h.plugin.warnings.length, 1);
});
test('deleting a journal pauses further writes', async () => {
  const h = harness({ 'Tasks.md': '- [ ] Task 🆔 tracked' });
  await h.plugin.scan();
  const journal = [...h.files.keys()].find(p => p.endsWith('.jsonl'))!;
  h.files.delete(journal);
  h.put('Tasks.md', '- [x] Task 🆔 tracked');
  await h.plugin.scan();
  assert.match(h.plugin.warnings[0], /journal disappeared/);
  assert.equal(h.plugin.events.length, 1);
});
test('duplicate IDs do not create false disappearances', async () => {
  const h = harness({ 'Tasks.md': '- [ ] Task 🆔 tracked' });
  await h.plugin.scan();
  h.put('Other.md', '- [ ] Copy 🆔 tracked');
  await h.plugin.scan();
  assert.equal(h.plugin.events.length, 1);
  assert.match(h.plugin.warnings[0], /Duplicate/);
});
test('pausing and excluding notes preserve history without writes', async () => {
  const h = harness({ 'Tasks.md': '- [ ] Task 🆔 tracked' });
  await h.plugin.scan();
  h.plugin.settings.recording = false;
  h.put('Tasks.md', '- [x] Task 🆔 tracked');
  await h.plugin.scan(); assert.equal(h.plugin.events.length, 1);
  h.plugin.settings.recording = true;
  h.plugin.settings.excludedFolders = 'Tasks.md';
  await h.plugin.scan(); assert.equal(h.plugin.events.length, 1);
});
