import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deploy } from '../scripts/deploy.mjs';

test('deployment preserves settings, activation, notes and workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'task-trace-deploy-'));
  try {
    const target = path.join(root, '.obsidian/plugins/task-trace');
    await mkdir(target, { recursive: true });
    const preserved = ['.obsidian/plugins/task-trace/data.json', '.obsidian/community-plugins.json', '.obsidian/workspace.json', 'Note.md'];
    for (const file of preserved) await writeFile(path.join(root, file), 'preserve');
    assert.equal(await deploy({ root }), target);
    for (const file of preserved) assert.equal(await readFile(path.join(root, file), 'utf8'), 'preserve');
    for (const file of ['main.js', 'manifest.json', 'styles.css']) assert.deepEqual(await readFile(path.join(target, file)), await readFile(path.join('dist', file)));
    await assert.rejects(deploy({ root, configName: '../escape' }));
    await assert.rejects(deploy({}));
  } finally { await rm(root, { recursive: true, force: true }); }
});
