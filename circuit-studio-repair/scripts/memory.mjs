import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function validateEntry(entry) {
  if (!entry || !nonempty(entry.id) || !nonempty(entry.projectId) || !nonempty(entry.text)
    || !['preference', 'correction'].includes(entry.type)) throw new Error('Entry needs id, projectId, type (preference/correction), and text.');
  if (!nonempty(entry.confirmation?.quote) || !nonempty(entry.confirmation?.at)
    || !Number.isFinite(Date.parse(entry.confirmation.at))) throw new Error('An explicit user confirmation quote and valid timestamp are required.');
  if (entry.source !== undefined && (!nonempty(entry.source?.file) || !/^[a-f0-9]{64}$/i.test(entry.source?.sha256 || ''))) throw new Error('Optional source needs a file and SHA-256.');
  return entry;
}

export async function loadMemory(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { schema: 'circuit-studio-memory/v1', entries: [] }; throw error; }
  const memory = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (memory.schema !== 'circuit-studio-memory/v1' || !Array.isArray(memory.entries)) throw new Error('Invalid memory file; existing data was not changed.');
  const ids = new Set();
  for (const entry of memory.entries) {
    validateEntry(entry);
    const key = JSON.stringify([entry.projectId, entry.id]);
    if (ids.has(key)) throw new Error('Duplicate memory ID within a project.');
    ids.add(key);
  }
  return memory;
}

async function saveMemory(file, memory) {
  const target = path.resolve(file), temp = target + '.' + randomUUID() + '.tmp';
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(temp, JSON.stringify(memory, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function remember(file, entry) {
  validateEntry(entry);
  const memory = await loadMemory(file);
  const index = memory.entries.findIndex(e => e.projectId === entry.projectId && e.id === entry.id);
  if (index < 0) memory.entries.push(entry); else memory.entries[index] = entry;
  await saveMemory(file, memory);
  return entry;
}

export async function list(file, projectId) {
  if (!nonempty(projectId)) throw new Error('An exact project ID is required.');
  return (await loadMemory(file)).entries.filter(e => e.projectId === projectId);
}

export async function forget(file, projectId, id) {
  if (!nonempty(projectId) || !nonempty(id)) throw new Error('Project ID and entry ID are required.');
  const memory = await loadMemory(file), before = memory.entries.length;
  memory.entries = memory.entries.filter(e => !(e.projectId === projectId && e.id === id));
  if (memory.entries.length !== before) await saveMemory(file, memory);
  return { removed: before - memory.entries.length };
}

async function main() {
  const [command, file, arg, id, ...extra] = process.argv.slice(2);
  if (!file || !arg || extra.length) throw new Error('Usage: memory.mjs list FILE PROJECT_ID | remember FILE ENTRY.json | forget FILE PROJECT_ID ENTRY_ID');
  let result;
  if (command === 'list' && !id) result = await list(file, arg);
  else if (command === 'remember' && !id) {
    if (path.resolve(file) === path.resolve(arg)) throw new Error('Memory would overwrite the entry input.');
    result = await remember(file, JSON.parse((await fs.readFile(arg, 'utf8')).replace(/^\uFEFF/, '')));
  } else if (command === 'forget' && id) result = await forget(file, arg, id);
  else throw new Error('Invalid memory command.');
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
