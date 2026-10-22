import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseInput, sha256 } from './report.mjs';

const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const text = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new Error('Missing ' + name); return value; };
const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name) && !['.', '..'].includes(name);

export async function initHistory(dir, scope) {
  text(scope.projectId, 'projectId'); text(scope.documentId, 'documentId');
  await fs.mkdir(dir, { recursive: true });
  const index = { schema: 'circuit-studio-history/v1', projectId: scope.projectId, documentId: scope.documentId, entries: [] };
  await fs.writeFile(path.join(dir, 'history.json'), encode(index), { flag: 'wx' });
  return index;
}

export async function lockHistory(dir) {
  const lock = path.join(dir, '.history-lock');
  try { await fs.mkdir(lock); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('History is in use; inspect a stale lock before removing it.'); throw error; }
  return () => fs.rmdir(lock);
}

export async function loadHistoryContext(dir) {
  dir = await fs.realpath(dir);
  const index = json(await fs.readFile(path.join(dir, 'history.json')));
  if (index.schema !== 'circuit-studio-history/v1' || !Array.isArray(index.entries)) throw new Error('Invalid project history');
  text(index.projectId, 'history projectId'); text(index.documentId, 'history documentId');
  const entries = [], seen = new Set();
  let previous = null, currentRequest = null;
  for (const item of index.entries) {
    if (!safeName(item.id) || seen.has(item.id)) throw new Error('Unsafe or duplicate history entry');
    seen.add(item.id);
    const folder = path.join(dir, item.id);
    if (await fs.realpath(folder) !== folder) throw new Error('History entry must not be redirected');
    const bytes = await fs.readFile(path.join(folder, 'entry.json'));
    if (sha256(bytes) !== item.sha256) throw new Error('History entry hash mismatch');
    const event = json(bytes);
    if (event.id !== item.id || event.previousId !== previous || event.projectId !== index.projectId || event.documentId !== index.documentId
        || !['report', 'round'].includes(event.type) || !Number.isFinite(Date.parse(event.recordedAt)) || !Array.isArray(event.files)) throw new Error('History scope or chain mismatch');
    const artifacts = {};
    for (const ref of event.files) {
      if (!safeName(ref.file) || artifacts[ref.file]) throw new Error('Unsafe or duplicate history artifact');
      const file = path.join(folder, ref.file);
      if (await fs.realpath(file) !== file) throw new Error('History artifact must not be redirected');
      const data = await fs.readFile(file);
      if (sha256(data) !== ref.sha256 || data.length !== ref.bytes) throw new Error('History artifact changed: ' + ref.file);
      // Earlier compiled prompts already embed history: keep their verified links to avoid recursive duplication.
      artifacts[ref.file] = { file, sha256: ref.sha256, ...(ref.file.endsWith('.bin') || ['history-context.json', 'repair-prompt.md'].includes(ref.file) ? {} : { content: data.toString('utf8') }) };
    }
    if (event.type === 'report') {
      if (!artifacts['input.txt'] || !artifacts['request.json'] || !artifacts['evidence.json']) throw new Error('Missing report history artifacts');
      currentRequest = json(Buffer.from(artifacts['request.json'].content));
      currentRequest.inputSha256 = artifacts['input.txt'].sha256;
    } else if (!artifacts['round.json'] || !artifacts['patch.js']) throw new Error('Missing round history artifacts');
    entries.push({ ...event, artifacts });
    previous = event.id;
  }
  return { schema: 'circuit-studio-history-context/v1', historyDir: dir, projectId: index.projectId,
    documentId: index.documentId, headId: previous, entries, currentRequest };
}

async function append(dir, type, fields, files) {
  const context = await loadHistoryContext(dir), id = randomUUID(), recordedAt = new Date().toISOString();
  const folder = path.join(context.historyDir, id);
  await fs.mkdir(folder);
  const event = { id, type, recordedAt, projectId: context.projectId, documentId: context.documentId,
    previousId: context.headId, ...fields, files: [] };
  for (const [name, bytes] of Object.entries(files)) {
    if (!safeName(name)) throw new Error('Unsafe history filename');
    await fs.writeFile(path.join(folder, name), bytes, { flag: 'wx' });
    event.files.push({ file: name, sha256: sha256(bytes), bytes: bytes.length });
  }
  const bytes = encode(event);
  await fs.writeFile(path.join(folder, 'entry.json'), bytes, { flag: 'wx' });
  const index = json(await fs.readFile(path.join(context.historyDir, 'history.json')));
  index.entries.push({ id, sha256: sha256(bytes) });
  const pending = path.join(context.historyDir, '.history-pending-' + id);
  await fs.writeFile(pending, encode(index), { flag: 'wx' });
  await fs.rename(pending, path.join(context.historyDir, 'history.json'));
  return event;
}

export async function recordReport(dir, { input, context, generationCode }) {
  text(context?.userRequest, 'current userRequest'); text(context?.goal, 'current goal');
  if (!Array.isArray(context.clarifications)) throw new Error('clarifications must be an array, empty if none');
  const ids = new Set();
  for (const clarification of context.clarifications) {
    for (const field of ['id', 'question', 'answer', 'at']) text(clarification[field], 'clarification ' + field);
    if (ids.has(clarification.id) || !Number.isFinite(Date.parse(clarification.at))) throw new Error('Invalid clarification ID or time');
    ids.add(clarification.id);
  }
  const release = await lockHistory(dir);
  try {
    const history = await loadHistoryContext(dir), bytes = await fs.readFile(input);
    if (context.supersedes !== undefined && (!Array.isArray(context.supersedes) || context.supersedes.some(id =>
      !history.entries.some(e => e.id === id && e.type === 'report')))) throw new Error('supersedes must identify earlier report/request entries in this history');
    const evidence = parseInput(bytes, { path: path.resolve(input), transport: 'file' });
    if (evidence.report?.document?.uuid && evidence.report.document.uuid !== history.documentId) throw new Error('Report belongs to a different document');
    const files = { 'input.txt': bytes, 'evidence.json': encode(evidence), 'request.json': encode(context) };
    if (generationCode) files['supplied-generation.js'] = await fs.readFile(generationCode);
    return await append(dir, 'report', { mode: evidence.mode, receivedFrom: path.resolve(input),
      ...(generationCode ? { generationCode: { source: path.resolve(generationCode), provenance: 'user-supplied historical code; execution not established by this import' } } : {}) }, files);
  } finally { await release(); }
}

export async function writeHistoryContext(dir, file) {
  const context = await loadHistoryContext(dir);
  if (!context.currentRequest) throw new Error('Record the current report and request before preparing history');
  const bytes = encode(context);
  await fs.writeFile(file, bytes, { flag: 'wx' });
  return { file: path.resolve(file), sha256: sha256(bytes), headId: context.headId,
    projectId: context.projectId, documentId: context.documentId };
}

export async function verifyHistoryReview(plan, baseDir, documentId) {
  const ref = plan.context?.history;
  if (!ref) throw new Error('Missing reviewed project history; record the report and read a fresh history context first.');
  text(ref.file, 'history context file');
  const file = path.resolve(baseDir, ref.file), bytes = await fs.readFile(file);
  if (sha256(bytes) !== ref.sha256) throw new Error('History context SHA-256 mismatch');
  const saved = json(bytes), context = await loadHistoryContext(saved.historyDir);
  if (JSON.stringify(saved) !== JSON.stringify(context)) throw new Error('History context is stale or changed; read a fresh context and review the plan/code.');
  if (context.projectId !== ref.projectId || context.documentId !== ref.documentId || context.documentId !== documentId || context.headId !== ref.headId) throw new Error('History review scope/head mismatch');
  if (!context.currentRequest || context.currentRequest.userRequest !== plan.context.userRequest || context.currentRequest.goal !== plan.goal
      || context.currentRequest.inputSha256 !== plan.inputSha256) throw new Error('Current report/request/goal does not match reviewed history');
  return { context, reference: { ...ref, file }, dir: context.historyDir, bytes };
}

export async function appendRound(dir, roundFile, { locked = false } = {}) {
  const release = locked ? null : await lockHistory(dir);
  try {
    const { verifyRound } = await import('./round.mjs');
    const checked = await verifyRound(roundFile), context = await loadHistoryContext(dir);
    if (checked.record.documentId !== context.documentId) throw new Error('Round belongs to a different document');
    if (checked.record.projectId !== undefined && checked.record.projectId !== context.projectId) throw new Error('Round belongs to a different project');
    if (context.entries.some(e => e.roundId === checked.record.roundId)) throw new Error('Round is already in history');
    const files = { 'round.json': await fs.readFile(checked.file) };
    if (sha256(files['round.json']) !== checked.sha256) throw new Error('Round changed while archiving');
    for (const ref of checked.record.artifacts) {
      const bytes = await fs.readFile(path.join(path.dirname(checked.file), ref.file));
      if (sha256(bytes) !== ref.sha256) throw new Error('Round artifact changed while archiving');
      files[ref.file] = bytes;
    }
    return await append(dir, 'round', { roundId: checked.record.roundId, status: checked.record.status }, files);
  } finally { if (release) await release(); }
}

export async function prepareRollback(dir, { roundId, baseline }) {
  const context = await loadHistoryContext(dir), entry = context.entries.find(e => e.type === 'round' && e.roundId === roundId);
  if (!entry) throw new Error('Requested round is not in this history');
  const bytes = await fs.readFile(baseline), current = json(bytes);
  if (current.document?.uuid !== context.documentId || typeof current.source !== 'string' || !current.source.trim()) throw new Error('Rollback needs an inspected baseline for this document');
  const before = entry.artifacts['before.json'], after = entry.artifacts['after.json'];
  if (!before || !after) throw new Error('Rollback requires historical before and after state; inspect manually instead');
  const historicalBefore = json(Buffer.from(before.content)), historicalAfter = json(Buffer.from(after.content));
  if ([historicalBefore, historicalAfter].some(s => s.document?.uuid !== context.documentId || typeof s.source !== 'string')) throw new Error('Incomplete historical rollback state');
  return { schema: 'circuit-studio-rollback-context/v1', projectId: context.projectId, documentId: context.documentId,
    roundId, historyHeadId: context.headId, baselineSha256: sha256(bytes), current, historicalBefore, historicalAfter,
    originalJavaScript: entry.artifacts['patch.js'].content, currentMatchesHistoricalAfter: current.source === historicalAfter.source,
    authorization: 'required', execution: 'not-executed', instructions: [
      'Review the historical change against current state and the explicit rollback request.',
      'Author a minimal inverse change preserving later unrelated edits; do not replay a whole historical snapshot.',
      'If affected objects or intent conflict, inspect or ask a decisive question before a ready plan.',
      'Execute reviewed Agent-authored JavaScript through the normal authorised round workflow with this fresh baseline.'
    ] };
}

export async function verifyRollback(plan, baseDir, baseline, history) {
  const ref = plan.context?.rollback;
  if (!ref) return null;
  text(ref.file, 'rollback context file');
  const bytes = await fs.readFile(path.resolve(baseDir, ref.file));
  if (sha256(bytes) !== ref.sha256) throw new Error('Rollback context SHA-256 mismatch');
  const context = json(bytes), expected = await prepareRollback(history.dir, { roundId: context.roundId, baseline });
  if (JSON.stringify(context) !== JSON.stringify(expected) || ref.authorized !== true || !text(ref.request, 'explicit rollback request')) throw new Error('Rollback context changed or explicit rollback authorization is missing');
  if (!plan.context.userRequest.includes(ref.request)) throw new Error('Rollback request must be part of the current user request');
  return { bytes, context };
}

async function main() {
  const [command, dir, ...args] = process.argv.slice(2);
  if (!dir) throw new Error('A scoped history directory is required');
  let result;
  if (command === 'init' && args.length === 2) result = await initHistory(dir, { projectId: args[0], documentId: args[1] });
  else if (command === 'record' && [2, 3].includes(args.length)) result = await recordReport(dir, { input: args[0], context: json(await fs.readFile(args[1])), generationCode: args[2] });
  else if (command === 'context' && args.length === 1) result = await writeHistoryContext(dir, args[0]);
  else if (command === 'import-round' && args.length === 1) result = await appendRound(dir, args[0]);
  else if (command === 'rollback' && args.length === 3) {
    result = await prepareRollback(dir, { roundId: args[0], baseline: args[1] });
    const bytes = encode(result); await fs.writeFile(args[2], bytes, { flag: 'wx' });
    result = { file: path.resolve(args[2]), sha256: sha256(bytes), authorization: 'required', execution: 'not-executed' };
  } else throw new Error('Usage: history.mjs init DIR PROJECT_ID DOCUMENT_UUID | record DIR INPUT REQUEST.json [INITIAL.js] | context DIR OUT.json | import-round DIR ROUND.json | rollback DIR ROUND_ID BASELINE.json OUT.json');
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
