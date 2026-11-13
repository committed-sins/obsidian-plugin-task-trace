import { ItemView, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, type Editor } from 'obsidian';
import { addId, changed, heads, historyFor, journalFolder, mergeEvents, parseJournal, parseTasks, planEvents, uniqueTasks, type FoundTask, type TraceEvent } from './core';

const VIEW = 'task-trace-history';
interface Settings { recording: boolean; folder: string; excludedFolders: string }
const defaults: Settings = { recording: true, folder: 'records/task-trace', excludedFolders: 'templates\narchives\nscripts\nlibraries\ninbound' };
export default class TaskTrace extends Plugin {
  settings: Settings = { ...defaults };
  events: TraceEvent[] = [];
  warnings: string[] = [];
  selectedId = '';
  folderNeedsReload = false;
  private writer = crypto.randomUUID();
  private timer = 0;
  private running = false;
  private rerun = false;
  private stopped = false;
  private notes = new Map<string, { stamp: string; tasks: FoundTask[] }>();
  private journals = new Map<string, { stamp: string; events: TraceEvent[] }>();
  private dirty = new Set<string>();
  private lastError = '';

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = { ...defaults, ...saved };
    try { this.settings.folder = journalFolder(this.settings.folder); }
    catch { this.settings.recording = false; new Notice('Task Trace: invalid journal folder. Recording is paused; check settings.'); }
    this.registerView(VIEW, leaf => new HistoryView(leaf, this));
    this.addSettingTab(new TraceSettings(this));
    this.addRibbonIcon('history', 'Task Trace history', () => { void this.openHistory(); });
    this.addCommand({ id: 'open-history', name: 'Open task history', callback: () => { void this.openHistory(); } });
    this.addCommand({ id: 'scan', name: 'Scan for task changes', callback: () => { void this.scan(); } });
    this.addCommand({ id: 'history-at-cursor', name: 'Show history of task at cursor', editorCallback: editor => this.historyAt(editor) });
    this.addCommand({ id: 'assign-id', name: 'Assign ID to task at cursor', editorCallback: editor => this.assignId(editor) });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      if (!/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/.test(editor.getLine(editor.getCursor().line))) return;
      menu.addItem(item => item.setTitle('Task Trace: show history').setIcon('history').onClick(() => this.historyAt(editor)));
      menu.addItem(item => item.setTitle('Task Trace: assign missing ID').setIcon('fingerprint').onClick(() => this.assignId(editor)));
    }));
    const changedFile = (file: { path: string }) => { this.dirty.add(file.path); this.schedule(); };
    this.registerEvent(this.app.vault.on('create', changedFile));
    this.registerEvent(this.app.vault.on('modify', changedFile));
    this.registerEvent(this.app.vault.on('delete', changedFile));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { this.dirty.add(oldPath); changedFile(file); }));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) this.schedule(); });
  }
  onunload(): void { this.stopped = true; window.clearTimeout(this.timer); }
  schedule(): void {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.scan(); }, 1500);
  }
  private excluded(path: string): boolean {
    return path === this.settings.folder || path.startsWith(this.settings.folder + '/') || this.settings.excludedFolders.split('\n').map(p => p.trim().replace(/\/$/, '')).filter(Boolean).some(p => path === p || path.startsWith(p + '/'));
  }
  async scan(): Promise<void> {
    if (this.stopped) return;
    if (this.running) { this.rerun = true; return; }
    this.running = true;
    try {
      if (this.folderNeedsReload) throw Error('Reload Task Trace after changing the journal folder.');
      const folder = journalFolder(this.settings.folder);
      const files = this.app.vault.getFiles();
      const logFiles = files.filter(f => f.path.startsWith(folder + '/') && f.extension === 'jsonl');
      const paths = new Set(logFiles.map(f => f.path));
      if ([...this.journals.keys()].some(p => !paths.has(p))) throw Error('A journal disappeared. Restore it or reload after reviewing synchronization.');
      for (const file of logFiles) {
        const stamp = file.stat.mtime + ':' + file.stat.size;
        if (this.journals.get(file.path)?.stamp !== stamp || this.dirty.has(file.path)) {
          const text = await this.app.vault.read(file);
          this.journals.set(file.path, { stamp, events: parseJournal(text) });
          this.dirty.delete(file.path);
        }
      }
      const events = mergeEvents([...this.journals.values()].flatMap(j => j.events));
      const markdown = files.filter(f => f.extension === 'md' && !this.excluded(f.path));
      const notePaths = new Set(markdown.map(f => f.path));
      for (const key of this.notes.keys()) if (!notePaths.has(key)) this.notes.delete(key);
      for (const file of markdown) {
        const stamp = file.stat.mtime + ':' + file.stat.size;
        if (this.notes.get(file.path)?.stamp !== stamp || this.dirty.has(file.path)) {
          const text = await this.app.vault.read(file);
          if (stamp !== file.stat.mtime + ':' + file.stat.size) { this.schedule(); return; }
          this.notes.set(file.path, { stamp, tasks: parseTasks(text, file.path) });
          this.dirty.delete(file.path);
        }
      }
      // An event arriving during an async read invalidates the snapshot.
      if (this.rerun || [...this.dirty].some(p => p.endsWith('.md') && !this.excluded(p) && notePaths.has(p))) { this.rerun = false; this.schedule(); return; }
      const snapshot = uniqueTasks([...this.notes.values()].flatMap(n => n.tasks));
      this.warnings = [...snapshot.duplicates].map(id => `Duplicate task ID: ${id}. Recording skipped for this ID.`);
      const groups = new Map<string, TraceEvent[]>();
      for (const e of events) { const group = groups.get(e.taskId) ?? []; group.push(e); groups.set(e.taskId, group); }
      for (const [id, group] of groups) {
        const known = new Set(group.map(e => e.eventId));
        if (group.some(e => e.parents.some(p => !known.has(p)))) this.warnings.push(`Incomplete journal ancestry for ${id}; recording skipped.`);
        else if (heads(group).length > 1) this.warnings.push(`Multiple observations for ${id}; divergent states pause recording for this ID.`);
      }
      this.events = events;
      if (this.settings.recording && !this.stopped) {
        // Excluded paths are deliberately out of scope, never interpreted as deletions.
        const held = new Set(snapshot.duplicates);
        for (const [id, group] of groups) if (heads(group).some(e => e.after && this.excluded(e.after.path))) held.add(id);
        const planned = planEvents(events, snapshot.tasks, held, this.writer, new Date().toISOString(), () => crypto.randomUUID());
        if (planned.length) {
          await this.ensureFolder(folder);
          const log = `${folder}/events-${this.writer}-${new Date().toISOString().slice(0, 7)}.jsonl`;
          // Each plugin session has its own writer UUID, avoiding shared append targets.
          const payload = planned.map(e => JSON.stringify(e)).join('\n') + '\n';
          const existing = this.app.vault.getAbstractFileByPath(log);
          if (existing instanceof TFile) await this.app.vault.append(existing, payload);
          else if (!existing) await this.app.vault.create(log, payload);
          else throw Error('Journal path is a directory.');
          const written = this.app.vault.getAbstractFileByPath(log);
          if (!(written instanceof TFile)) throw Error('Journal write could not be confirmed.');
          // Force a real read before the next scan; preserve accumulated raw events now.
          this.journals.set(log, { stamp: '', events: [...(this.journals.get(log)?.events ?? []), ...planned] });
          this.events = mergeEvents([...events, ...planned]);
        }
      }
      this.lastError = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scan failed.';
      this.warnings = [message];
      if (message !== this.lastError) new Notice('Task Trace: ' + message, 10000);
      this.lastError = message;
    } finally {
      this.running = false;
      this.refreshViews();
      if (this.rerun) { this.rerun = false; this.schedule(); }
    }
  }
  private async ensureFolder(folder: string): Promise<void> {
    let current = '';
    for (const part of folder.split('/')) {
      current = current ? current + '/' + part : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw Error('Journal folder is occupied by a file.');
      if (!existing) await this.app.vault.createFolder(current);
    }
  }
  assignId(editor: Editor): void {
    try {
      const cursor = editor.getCursor(), line = editor.getLine(cursor.line);
      const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (!file || !/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/.test(line)) throw Error('Place the cursor on a Markdown task.');
      // Reject code/frontmatter examples using the same document parser, before editing.
      const id = crypto.randomUUID();
      const replacement = addId(line, id);
      const lines = editor.getValue().split('\n'); lines[cursor.line] = replacement;
      if (!parseTasks(lines.join('\n'), file.path).some(t => t.id === id && t.line === cursor.line)) throw Error('This line is inside code or frontmatter, or is not a supported task.');
      editor.replaceRange(replacement, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
      editor.setCursor(cursor);
      new Notice('Task Trace: ID assigned. History starts after the note is saved.');
    } catch (error) { new Notice(error instanceof Error ? error.message : 'Could not assign ID.'); }
  }
  historyAt(editor: Editor): void {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    try {
      const task = parseTasks(editor.getValue(), file?.path ?? '').find(t => t.line === editor.getCursor().line);
      if (!task) { new Notice('Task Trace: this task needs a single 🆔 ID first.'); return; }
      this.selectedId = task.id; void this.openHistory();
    } catch (error) { new Notice(error instanceof Error ? error.message : 'Could not read task.'); }
  }
  async openHistory(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right; await leaf.setViewState({ type: VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf); this.refreshViews();
  }
  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof HistoryView) leaf.view.render();
  }
}

class HistoryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: TaskTrace) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'Task Trace'; }
  getIcon(): string { return 'history'; }
  async onOpen(): Promise<void> { this.render(); }
  render(): void {
    const root = this.contentEl; root.empty(); root.addClass('task-trace-view');
    root.createEl('h2', { text: 'Task Trace' });
    root.createEl('p', { text: 'Development preview · Times show observations, not guaranteed edit times.', cls: 'task-trace-muted' });
    for (const warning of this.plugin.warnings) root.createEl('p', { text: warning, cls: 'task-trace-warning' });
    const ids = [...new Set(this.plugin.events.map(e => e.taskId))].sort();
    if (!ids.length) { root.createEl('p', { text: 'Assign a task an ID, save the note, then change it. Its history appears here.' }); return; }
    if (!ids.includes(this.plugin.selectedId)) this.plugin.selectedId = ids[0];
    new Setting(root).setName('Task').addDropdown(dropdown => {
      for (const id of ids) {
        const latest = this.plugin.events.filter(e => e.taskId === id).at(-1);
        dropdown.addOption(id, ((latest?.after ?? latest?.before)?.text ?? id).slice(0, 70) + ' · ' + id);
      }
      dropdown.setValue(this.plugin.selectedId).onChange(value => { this.plugin.selectedId = value; this.render(); });
    });
    const history = historyFor(this.plugin.events, this.plugin.selectedId);
    const changes = history.filter(e => e.kind === 'change');
    const rescheduled = changes.filter(e => changed(e.before, e.after).some(key => ['due', 'scheduled', 'start'].includes(key))).length;
    root.createEl('p', { text: `${changes.length} observed changes · ${rescheduled} rescheduled` });
    for (const event of history.slice().reverse()) {
      const card = root.createDiv({ cls: 'task-trace-event' });
      card.createEl('strong', { text: new Date(event.observedAt).toLocaleString() });
      card.createEl('div', { text: { baseline: 'First observed (baseline)', change: 'Changed', disappeared: 'Disappeared — cause unknown', reappeared: 'Reappeared' }[event.kind] });
      for (const key of changed(event.before, event.after)) card.createEl('p', { text: `${key}: ${event.before?.[key] || '—'} → ${event.after?.[key] || '—'}` });
      const state = event.after ?? event.before;
      if (state) {
        const link = card.createEl('a', { text: state.path, href: '#' });
        link.addEventListener('click', event => { event.preventDefault(); void this.app.workspace.openLinkText(state.path, '', false); });
      }
    }
  }
}
class TraceSettings extends PluginSettingTab {
  constructor(private plugin: TaskTrace) { super(plugin.app, plugin); }
  display(): void {
    const root = this.containerEl; root.empty();
    root.createEl('h2', { text: 'Task Trace' });
    root.createEl('p', { text: 'Records saved Markdown tasks with a single 🆔 ID. Notes are changed only by the explicit assign-ID command. Journals contain task text and paths; synchronize and protect them with your vault.' });
    new Setting(root).setName('Record observations').setDesc('Pause to browse history without adding observations.').addToggle(toggle => toggle.setValue(this.plugin.settings.recording).onChange(async value => {
      this.plugin.settings.recording = value; await this.plugin.saveData(this.plugin.settings); this.plugin.schedule();
    }));
    new Setting(root).setName('Journal folder').setDesc('Default: records/task-trace. Synchronize this folder on every device. Move existing journals manually while recording is paused.').addText(text => {
      text.setValue(this.plugin.settings.folder);
      text.inputEl.addEventListener('change', () => {
        void (async () => {
          try {
            const folder = journalFolder(text.getValue());
            if (folder === this.plugin.settings.folder) return;
            if (this.plugin.settings.recording) throw Error('Pause recording before changing the journal folder.');
            // Reload clears caches only after the user has moved/reviewed journals.
            this.plugin.settings.folder = folder; await this.plugin.saveData(this.plugin.settings);
            this.plugin.folderNeedsReload = true;
            new Notice('Task Trace: reload the plugin before scanning the new journal folder.');
          } catch (error) { new Notice(error instanceof Error ? error.message : 'Invalid folder.'); text.setValue(this.plugin.settings.folder); }
        })();
      });
    });
    new Setting(root).setName('Excluded folders').setDesc('One vault-relative folder per line. Existing histories remain available.').addTextArea(text => text.setValue(this.plugin.settings.excludedFolders).onChange(async value => {
      this.plugin.settings.excludedFolders = value; await this.plugin.saveData(this.plugin.settings); this.plugin.schedule();
    }));
    root.createEl('p', { text: 'Automatic ID assignment, recurrence-series linking, conflict resolution and direct Tasks-menu hooks are planned. Preview supports emoji-format metadata, not Dataview task fields.' });
  }
}
