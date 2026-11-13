export interface TaskState {
  path: string; section: string; status: string; text: string;
  due: string; scheduled: string; start: string; done: string; cancelled: string;
}
export interface FoundTask { id: string; line: number; state: TaskState }
export interface TraceEvent {
  schema: 1; eventId: string; writer: string; taskId: string; observedAt: string;
  parents: string[]; before: TaskState | null; after: TaskState | null;
  kind: 'baseline' | 'change' | 'disappeared' | 'reappeared';
}
export const fields = ['path', 'section', 'status', 'text', 'due', 'scheduled', 'start', 'done', 'cancelled'] as const;
export function same(a: TaskState | null, b: TaskState | null): boolean {
  return a === null || b === null ? a === b : fields.every(key => a[key] === b[key]);
}
export function changed(a: TaskState | null, b: TaskState | null): (typeof fields[number])[] {
  return a && b ? fields.filter(key => a[key] !== b[key]) : [];
}
export function parseTasks(content: string, path: string): FoundTask[] {
  const result: FoundTask[] = [];
  let fence = '', fenceLength = 0, frontmatter = false, comment = false;
  const headings: string[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (index === 0 && line.replace(/^\uFEFF/, '') === '---') { frontmatter = true; return; }
    if (frontmatter) { if (/^(---|\.\.\.)\s*$/.test(line)) frontmatter = false; return; }
    if (comment) { if (line.includes('-->')) comment = false; return; }
    if (line.trimStart().startsWith('<!--')) { comment = !line.includes('-->'); return; }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength && /^\s*(`+|~+)\s*$/.test(line)) fence = '';
      return;
    }
    if (fence) return;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { headings.length = heading[1].length; headings[heading[1].length - 1] = heading[2]; return; }
    const task = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]\s+(.+)$/.exec(line);
    if (!task) return;
    const ids = [...task[2].matchAll(/🆔\s+([A-Za-z0-9_-]+)(?=\s|$)/gu)];
    if (ids.length > 1) throw Error(`Multiple IDs on one task in ${path}:${index + 1}. Recording paused.`);
    if (ids.length !== 1) return;
    const state: TaskState = { path, section: headings.filter(Boolean).join(' / '), status: task[1], text: task[2].replace(/🆔\s+[A-Za-z0-9_-]+(?=\s|$)/gu, ''), due: '', scheduled: '', start: '', done: '', cancelled: '' };
    for (const [emoji, field] of [['📅', 'due'], ['⏳', 'scheduled'], ['🛫', 'start'], ['✅', 'done'], ['❌', 'cancelled']] as const) {
      state.text = state.text.replace(new RegExp(emoji + '\\s+(\\d{4}-\\d{2}-\\d{2})', 'gu'), (_, date: string) => { state[field] = date; return ''; });
    }
    state.text = state.text.replace(/\s+/g, ' ').trim();
    result.push({ id: ids[0][1], line: index, state });
  });
  return result;
}
export function uniqueTasks(tasks: FoundTask[]): { tasks: Map<string, TaskState>; duplicates: Set<string> } {
  const states = new Map<string, TaskState>(), duplicates = new Set<string>();
  for (const task of tasks) {
    if (states.has(task.id)) duplicates.add(task.id);
    states.set(task.id, task.state);
  }
  for (const id of duplicates) states.delete(id);
  return { tasks: states, duplicates };
}
function validState(value: unknown): value is TaskState | null {
  if (value === null) return true;
  return typeof value === 'object' && fields.every(key => typeof (value as Record<string, unknown>)[key] === 'string');
}
export function parseJournal(text: string): TraceEvent[] {
  return text.split('\n').filter(line => line.trim()).map(line => {
    const e = JSON.parse(line) as TraceEvent;
    if (!e || e.schema !== 1 || typeof e.eventId !== 'string' || typeof e.taskId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(e.eventId) || !/^[A-Za-z0-9_-]+$/.test(e.taskId)
      || typeof e.writer !== 'string' || typeof e.observedAt !== 'string' || !Number.isFinite(Date.parse(e.observedAt))
      || !Array.isArray(e.parents) || !e.parents.every(p => typeof p === 'string' && /^[A-Za-z0-9_-]+$/.test(p))
      || !validState(e.before) || !validState(e.after) || !['baseline', 'change', 'disappeared', 'reappeared'].includes(e.kind)) throw Error('Unsupported or malformed Task Trace journal. Recording paused.');
    return e;
  });
}
export function mergeEvents(events: TraceEvent[]): TraceEvent[] {
  const map = new Map<string, TraceEvent>();
  for (const event of events) {
    const old = map.get(event.eventId);
    if (old && JSON.stringify(old) !== JSON.stringify(event)) throw Error('Conflicting journal event IDs. Recording paused.');
    map.set(event.eventId, event);
  }
  const incoming = new Map<string, number>(), children = new Map<string, string[]>();
  for (const e of map.values()) {
    incoming.set(e.eventId, 0);
    for (const parent of new Set(e.parents)) {
      const prior = map.get(parent);
      if (!prior) continue;
      if (prior.taskId !== e.taskId) throw Error('Journal ancestry crosses task identities. Recording paused.');
      incoming.set(e.eventId, (incoming.get(e.eventId) ?? 0) + 1);
      const list = children.get(parent) ?? []; list.push(e.eventId); children.set(parent, list);
    }
  }
  const ready = [...incoming.keys()].filter(id => incoming.get(id) === 0);
  for (let i = 0; i < ready.length; i++) for (const child of children.get(ready[i]) ?? []) {
    incoming.set(child, incoming.get(child)! - 1);
    if (incoming.get(child) === 0) ready.push(child);
  }
  if (ready.length !== map.size) throw Error('Cyclic journal ancestry. Recording paused.');
  return [...map.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.eventId.localeCompare(b.eventId));
}
export function heads(events: TraceEvent[]): TraceEvent[] {
  const parents = new Set(events.flatMap(e => e.parents));
  return events.filter(e => !parents.has(e.eventId));
}
export function planEvents(events: TraceEvent[], current: Map<string, TaskState>, duplicates: Set<string>, writer: string, observedAt: string, uuid: () => string): TraceEvent[] {
  const groups = new Map<string, TraceEvent[]>();
  for (const e of events) { const group = groups.get(e.taskId) ?? []; group.push(e); groups.set(e.taskId, group); }
  const planned: TraceEvent[] = [];
  for (const id of new Set([...groups.keys(), ...current.keys()])) {
    if (duplicates.has(id)) continue;
    const group = groups.get(id) ?? [], latest = heads(group), after = current.get(id) ?? null;
    // Missing parents mean synchronization is incomplete. Never guess a baseline.
    const known = new Set(group.map(e => e.eventId));
    if (group.some(e => e.parents.some(p => !known.has(p)))) continue;
    // Equivalent heads may arise when devices observe the same change before logs sync.
    // Divergent heads require human review; no arbitrary last-writer winner.
    if (latest.length > 1 && !latest.every(e => same(e.after, latest[0].after))) continue;
    const before = latest[0]?.after ?? null;
    if (latest.length && same(before, after)) continue;
    if (!latest.length && after === null) continue;
    planned.push({ schema: 1, eventId: uuid(), writer, taskId: id, observedAt, parents: latest.map(e => e.eventId).sort(), before, after,
      kind: !latest.length ? 'baseline' : after === null ? 'disappeared' : before === null ? 'reappeared' : 'change' });
  }
  return planned;
}
export function historyFor(events: TraceEvent[], id: string): TraceEvent[] {
  // Deduplicate identical observations sharing causal parents, preserving raw logs.
  const seen = new Set<string>();
  return events.filter(e => {
    if (e.taskId !== id) return false;
    const key = JSON.stringify([e.parents.slice().sort(), e.before, e.after]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function journalFolder(value: string): string {
  const path = value.trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!path || path.startsWith('/') || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw Error('Use a non-hidden relative vault folder, e.g. records/task-trace.');
  return path;
}
export function addId(line: string, id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Error('Invalid ID.');
  if (!/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s+\S/.test(line)) throw Error('Place the cursor on a Markdown task.');
  if (line.includes('🆔')) throw Error('This task already has an ID marker; existing IDs are never changed.');
  const block = /\s+\^[A-Za-z0-9-]+\s*$/.exec(line);
  return block ? line.slice(0, block.index).trimEnd() + ' 🆔 ' + id + block[0] : line.trimEnd() + ' 🆔 ' + id;
}
