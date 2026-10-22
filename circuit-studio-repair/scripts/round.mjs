import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseInput, compile, normalize, sha256, verifyLiveEvidence } from './report.mjs';
import { discover, selectWindow, execute } from './bridge.mjs';
import { verifyHistoryReview, lockHistory, appendRound, verifyRollback } from './history.mjs';

const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const requireText = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing ' + name);
  return value;
};
const contained = (root, file) => {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

// Integrity is not intent validation or evidence of a successful repair.
export async function verifyRound(file) {
  const location = path.resolve(file), root = await fs.realpath(path.dirname(location));
  const bytes = await fs.readFile(location), record = json(bytes);
  if (record.schema !== 'circuit-studio-round/v1' || !Array.isArray(record.artifacts) || !record.artifacts.length) throw new Error('Invalid round manifest');
  requireText(record.roundId, 'roundId'); requireText(record.documentId, 'documentId');
  const seen = new Set(), archived = new Map();
  for (const item of record.artifacts) {
    requireText(item.file, 'artifact file');
    const target = path.resolve(root, item.file);
    if (!contained(root, target) || seen.has(target)) throw new Error('Unsafe or duplicate artifact path');
    seen.add(target);
    if (!contained(root, await fs.realpath(target))) throw new Error('Artifact resolves outside its round');
    const data = await fs.readFile(target);
    if (sha256(data) !== item.sha256 || data.length !== item.bytes) throw new Error('Artifact changed: ' + item.file);
    archived.set(item.file, data);
  }
  for (const required of ['input.txt', 'repair-plan.json', 'repair-prompt.md', 'patch.js', 'baseline.json', 'execution-result.json']) {
    if (!record.artifacts.some(item => item.file === required)) throw new Error('Missing round artifact: ' + required);
  }
  for (const [field, file] of [['inputSha256', 'input.txt'], ['planSha256', 'repair-plan.json'], ['codeSha256', 'patch.js']]) {
    if (record[field] !== sha256(archived.get(file))) throw new Error('Round metadata hash mismatch: ' + field);
  }
  const plan = json(archived.get('repair-plan.json')), result = json(archived.get('execution-result.json'));
  compile(plan, parseInput(archived.get('input.txt')));
  if (plan.steps.find(step => step.id === record.stepId)?.documentId !== record.documentId
      || json(archived.get('baseline.json')).document?.uuid !== record.documentId) throw new Error('Round metadata does not match plan/baseline document.');
  for (const field of ['roundId', 'documentId', 'inputSha256', 'status']) {
    if (result[field] !== record[field]) throw new Error('Execution result metadata mismatch: ' + field);
  }
  if (record.projectId !== undefined) {
    const historyBytes = archived.get('history-context.json');
    if (!historyBytes || sha256(historyBytes) !== record.historyContextSha256) throw new Error('Archived history context hash mismatch');
    const history = json(historyBytes);
    if (history.projectId !== record.projectId || history.documentId !== record.documentId || history.headId !== record.historyHeadId
        || plan.context?.history?.sha256 !== record.historyContextSha256) throw new Error('Archived history context scope mismatch');
  }
  if (record.previousRoundId !== null) {
    const prior = archived.get('previous-round.json');
    if (!prior || sha256(prior) !== record.previousManifest?.sha256) throw new Error('Previous manifest hash mismatch.');
    const previous = json(prior);
    if (previous.roundId !== record.previousRoundId || previous.documentId !== record.documentId) throw new Error('Previous round identity mismatch.');
  } else if (record.previousManifest !== null || archived.has('previous-round.json')) throw new Error('Unexpected previous round metadata.');
  return { record, sha256: sha256(bytes), file: location };
}

export async function executeRound(options) {
  for (const name of ['input', 'plan', 'step', 'code', 'baseline', 'outDir']) requireText(options[name], name);
  const [inputBytes, planBytes, codeBytes, baselineBytes] = await Promise.all(
    [options.input, options.plan, options.code, options.baseline].map(file => fs.readFile(file)));
  const evidence = parseInput(inputBytes, { path: path.resolve(options.input), transport: 'file' });
  const plan = json(planBytes), baseline = json(baselineBytes);
  compile(plan, evidence);
  if (plan.context?.executionScope !== 'authorized-repair') throw new Error('Record the current repair authorization in executionScope first.');
  requireText(plan.context?.userRequest, 'context.userRequest');
  const step = plan.steps.find(item => item.id === options.step);
  if (!step || step.disposition !== 'ready') throw new Error('Select one ready step; inspect/needs-input steps cannot execute.');
  if (baseline.document?.uuid !== step.documentId || typeof baseline.source !== 'string' || !baseline.source.trim()) throw new Error('Baseline must contain the matching document and complete source.');
  const code = new TextDecoder('utf-8', { fatal: true }).decode(codeBytes);
  requireText(code, 'Agent-authored JavaScript');
  // Syntax-check an async function body without invoking it.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  new AsyncFunction('eda', code);
  const verified = await verifyLiveEvidence(plan, path.dirname(path.resolve(options.plan)));
  const previous = options.previous ? await verifyRound(options.previous) : null;
  if (previous && previous.record.documentId !== step.documentId) throw new Error('Previous round belongs to a different document.');
  const baseDir = path.dirname(path.resolve(options.plan));
  const history = await verifyHistoryReview(plan, baseDir, step.documentId);
  if (previous && !history.context.entries.some(entry => entry.roundId === previous.record.roundId)) throw new Error('Previous round is missing from the reviewed project history');
  const rollback = await verifyRollback(plan, baseDir, options.baseline, history);
  const prompt = compile(plan, evidence, history.context);
  const releaseHistory = await lockHistory(history.dir);
  try {
  // Recheck after acquiring the lock; another report must not silently supersede the reviewed request.
  await verifyHistoryReview(plan, baseDir, step.documentId);

  // A new directory prevents a changed request or script from overwriting history.
  const dir = path.resolve(options.outDir);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.mkdir(dir);
  const record = {
    schema: 'circuit-studio-round/v1', roundId: randomUUID(),
    previousRoundId: previous?.record.roundId ?? null,
    previousManifest: previous ? { file: previous.file, sha256: previous.sha256 } : null,
    startedAt: new Date().toISOString(), finishedAt: null,
    documentId: step.documentId, windowId: null, stepId: step.id,
    projectId: history.context.projectId, historyHeadId: history.context.headId, historyContextSha256: history.reference.sha256,
    inputSha256: evidence.provenance.sha256, planSha256: sha256(planBytes), codeSha256: sha256(codeBytes),
    status: 'not-executed', artifacts: [],
    stages: { preflight: 'not-run', execution: 'not-run', readback: 'not-run', drc: 'not-run' },
    errors: [], liveEvidence: []
  };
  const save = async (file, value) => {
    const bytes = Buffer.isBuffer(value) ? value : encode(value);
    await fs.writeFile(path.join(dir, file), bytes, { flag: 'wx' });
    record.artifacts.push({ file, sha256: sha256(bytes), bytes: bytes.length });
  };
  const checkpoint = async () => {
    const temp = path.join(dir, '.round.pending');
    await fs.writeFile(temp, encode(record));
    await fs.rename(temp, path.join(dir, 'round.json'));
  };
  let dispatched = false, base, drcStatus = 'not-run';
  try {
    await save('input.txt', inputBytes);
    await save('repair-plan.json', planBytes);
    await save('repair-prompt.md', Buffer.from(prompt));
    await save('patch.js', codeBytes);
    await save('baseline.json', baselineBytes);
    await save('history-context.json', history.bytes);
    if (rollback) await save('rollback-context.json', rollback.bytes);
    for (const [i, ref] of verified.entries()) {
      const bytes = await fs.readFile(ref.file);
      if (sha256(bytes) !== ref.sha256) throw new Error('Live evidence changed before archiving: ' + ref.file);
      const file = 'live-evidence-' + (i + 1) + '.bin';
      await save(file, bytes); record.liveEvidence.push({ ...ref, archivedFile: file });
    }
    if (previous) await save('previous-round.json', await fs.readFile(previous.file).then(bytes => {
      if (sha256(bytes) !== previous.sha256) throw new Error('Previous manifest changed during preparation.');
      return bytes;
    }));
    await checkpoint();
    ({ base } = await discover(options.port));
    record.windowId = await selectWindow(base, options.window);
    const before = await execute(base, record.windowId, 'inspect', { documentId: step.documentId });
    await save('before.json', before);
    if (before.document?.uuid !== step.documentId || before.source !== baseline.source) throw new Error('Live source differs from the reviewed baseline. Inspect again and revise the plan/code before a new round.');
    record.stages.preflight = 'passed';
    record.status = 'execution-unknown'; record.stages.execution = 'dispatching';
    // Persist the unknown state BEFORE the call: a crash/timeout must not imply no write.
    await checkpoint(); dispatched = true;
    try {
      const returned = await execute(base, record.windowId, 'run', { documentId: step.documentId, code, expectedSource: baseline.source });
      await save('bridge-result.json', { returned: returned ?? null });
      record.stages.execution = 'returned';
    } catch (error) {
      record.stages.execution = 'unknown'; record.errors.push({ stage: 'execution', message: error.message });
    }
    try { await checkpoint(); record.stages.postWriteCheckpoint = 'saved'; }
    catch (error) {
      record.stages.postWriteCheckpoint = 'failed';
      record.errors.push({ stage: 'recording', message: 'Post-write checkpoint failed: ' + error.message });
    }
    // Readback and DRC are independent attempts. A failed/uncertain write is never retried.
    try {
      const after = await execute(base, record.windowId, 'inspect', { documentId: step.documentId });
      await save('after.json', after); record.stages.readback = 'captured';
    } catch (error) {
      record.stages.readback = 'failed'; record.errors.push({ stage: 'readback', message: error.message });
    }
    try {
      const drc = await execute(base, record.windowId, 'drc', { documentId: step.documentId });
      await save('drc-after.json', drc);
      drcStatus = normalize(drc).drcStatus;
      record.stages.drc = drcStatus === 'complete' && drc.diag?.rerun === true ? 'captured' : 'incomplete';
    } catch (error) {
      record.stages.drc = 'failed'; record.errors.push({ stage: 'drc', message: error.message });
    }
    record.status = record.stages.execution !== 'returned' ? 'execution-unknown'
      : record.stages.postWriteCheckpoint === 'failed' || record.stages.readback !== 'captured' || record.stages.drc !== 'captured' ? 'executed-checks-incomplete'
      : 'executed-awaiting-review';
  } catch (error) {
    record.status = dispatched ? 'execution-unknown' : 'blocked';
    if (!dispatched) record.stages.preflight = 'failed';
    record.errors.push({ stage: dispatched ? 'recording' : 'preflight', message: error.message });
  } finally {
    record.finishedAt = new Date().toISOString();
    await save('execution-result.json', {
      schema: 'circuit-studio-execution/v1', roundId: record.roundId, inputSha256: record.inputSha256,
      status: record.status, documentId: record.documentId, windowId: record.windowId,
      userRequest: plan.context.userRequest, goal: plan.goal, preserve: plan.preserve,
      steps: [{ id: step.id, execution: record.stages.execution, targets: step.targets, desiredState: step.desiredState,
        evidence: step.evidence, verification: step.verify.map(check => ({ check, status: 'not-assessed' })) }],
      checks: { readback: record.stages.readback, drcCapture: record.stages.drc, drcStatus, postWriteCheckpoint: record.stages.postWriteCheckpoint ?? 'not-run',
        requirements: 'not-assessed', preservation: 'not-assessed' },
      remaining: ['Agent/user review of changed state, requested goal and preservation constraints is still required.',
        'A returned Bridge call or complete DRC log does not establish repair or electrical correctness.'], errors: record.errors
    });
    await checkpoint();
  }
  try { await appendRound(history.dir, path.join(dir, 'round.json'), { locked: true }); }
  catch (error) { throw new Error('Round saved at ' + path.join(dir, 'round.json') + '; history append failed: ' + error.message + '. Inspect the saved outcome and use history.mjs import-round; do not repeat the write.'); }
  return { file: path.join(dir, 'round.json'), record };
  } finally { await releaseHistory(); }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'verify' && args.length === 1) {
    const result = await verifyRound(args[0]);
    console.log(JSON.stringify({ roundId: result.record.roundId, artifacts: result.record.artifacts.length, integrity: 'verified', correctness: 'not-assessed' }));
    return;
  }
  if (command !== 'execute') throw new Error('Usage: round.mjs verify ROUND.json | execute --input INPUT --plan PLAN --step ID --code PATCH.js --baseline INSPECT.json --out-dir NEW_DIRECTORY [--previous ROUND.json] [--port N] [--window ID]');
  const allowed = ['input', 'plan', 'step', 'code', 'baseline', 'out-dir', 'previous', 'port', 'window'];
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !allowed.includes(key) || !args[i + 1] || options[key] !== undefined) throw new Error('Invalid or duplicate option');
    options[key] = args[i + 1];
  }
  options.outDir = options['out-dir'];
  const result = await executeRound(options);
  console.log(JSON.stringify({ manifest: result.file, roundId: result.record.roundId, status: result.record.status }));
  if (result.record.status !== 'executed-awaiting-review') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
