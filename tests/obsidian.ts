export class TFile { path = ''; extension = ''; stat = { mtime: 0, size: 0, ctime: 0 }; }
export class Plugin { constructor(public app: unknown, public manifest: unknown) {} }
export class ItemView {}
export class MarkdownView {}
export class PluginSettingTab {}
export class WorkspaceLeaf {}
export class Setting {}
export class Notice { static messages: string[] = []; constructor(message: string) { Notice.messages.push(message); } }
