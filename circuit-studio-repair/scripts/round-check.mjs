import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { executeRound, verifyRound } from './round.mjs';
import { parseInput, sha256 } from './report.mjs';

// All inputs, outputs and editor state are synthetic. The server binds only to
// loopback, on an ephemeral port explicitly passed to every execution.
const tempRoot = await fs.realpath(os.tmpdir());
const temp = await fs.mkdtemp(path.join(tempRoot, 'circuit-round-check-'));
const documentId = 'synthetic-page';
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const source = endpoint => JSON.stringify({
  wire: { id: 'wire-1', endpoint },
  untouched: { id: 'resistor-2', value: '10k' }
});
const originalSource = source('old-pin');
const desiredSource = source('new-pin');
const patch = `// SYNTHETIC_ROUND_PATCH
const state = await eda.sample.read();
if (state.wire.endpoint === 'new-pin') return { status: 'already-satisfied' };
state.wire.endpoint = 'new-pin';
await eda.sample.write(state);
return { status: 'applied', primitiveId: 'wire-1' };
`;

let state;
function reset(overrides = {}) {
  state = {
    documentId, source: originalSource, calls: [], requests: [], writes: 0,
    inspectCount: 0, drcChecks: 0, ...overrides
  };
}
reset();

function panel(generation) {
  const lines = [
    ['info', `Start Design Rule Checking ${generation}`, false],
    ['warning', 'Unrelated synthetic warning remains visible.', false],
    ['info', `Finish Design Rule Checking ${generation}`, true]
  ];
  const nodes = lines.map(([severity, text, summary], index) => ({
    isConnected: true, innerText: text,
    classList: { contains: name => name === (severity === 'warning' ? 'warn' : severity) },
    getAttribute: name => name === 'data-log-index' ? String(index) : null,
    querySelector: selector => selector === '.content' ? { innerText: text }
      : selector === '.timestamp' ? { textContent: 'synthetic-time' }
        : selector === '[i18n="Finish Design Rule Checking."]' && summary ? {} : null,
    querySelectorAll: () => []
  }));
  const scroller = { isConnected: true, scrollTop: 0, clientHeight: 100,
    scrollHeight: 100, dispatchEvent() {} };
  const label = { parentElement: { textContent: 'All (3)', querySelector: () => null } };
  return {
    isConnected: true, nodes,
    querySelector: selector => selector === '[class*="log-container-content_"]' ? scroller
      : selector === '[data-test="All"]' ? label
        : selector === 'p.log[data-log-index]' ? nodes[0] : null,
    querySelectorAll: selector => selector === 'p.log[data-log-index]' ? nodes : []
  };
}

async function runEditor(code, command) {
  let root = panel('old');
  const doc = {
    defaultView: { Event: class Event {}, MessageChannel },
    querySelector: selector => selector === '#schDrcPrimaryLog' ? root : null
  };
  const eda = {
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ uuid: state.documentId, type: 'SCH_PAGE' }) },
    sys_FileManager: { getDocumentSource: async () => {
      const value = state.source;
      if (command === 'inspect' && state.changeDocumentDuringInspect) {
        state.documentId = 'different-page';
        state.changeDocumentDuringInspect = false;
      }
      return value;
    } },
    sys_PanelControl: { openBottomPanel: async () => {} },
    sch_Drc: { check: async () => {
      state.drcChecks++;
      if (state.drcFailure) throw new Error('Synthetic DRC failed.');
      root.isConnected = false;
      root.nodes.forEach(node => { node.isConnected = false; });
      root = panel('fresh');
      return false; // A captured log containing violations is not a repair verdict.
    } },
    sample: {
      read: async () => JSON.parse(state.source),
      write: async value => {
        state.source = JSON.stringify(value);
        state.writes++;
        if (state.switchDocumentAfterWrite) state.documentId = 'different-page';
        if (state.throwAfterWrite) throw new Error('Synthetic failure after mutation.');
      }
    }
  };
  const context = vm.createContext({
    eda, window: { parent: { document: doc } }, setTimeout, clearTimeout, MessageChannel
  });
  return new vm.Script(`(async () => {\n${code}\n})()`, {
    filename: 'synthetic-editor-call.js'
  }).runInContext(context, { timeout: 2000 });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  state.requests.push(req.url);
  if (req.url === '/health') {
    res.end(JSON.stringify({ service: 'easyeda-bridge', edaConnected: true }));
    return;
  }
  if (req.url === '/eda-windows') {
    res.end(JSON.stringify({ windows: [{ windowId: 'synthetic-window', connected: true }] }));
    return;
  }
  if (req.url !== '/execute') { res.statusCode = 404; res.end('{}'); return; }
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    assert.equal(payload.windowId, 'synthetic-window');
    const command = payload.code.includes('SYNTHETIC_ROUND_PATCH') ? 'run'
      : payload.code.includes('CircuitStudioLinter.runLint') ? 'drc' : 'inspect';
    state.calls.push(command);
    if (command === 'inspect') {
      state.inspectCount++;
      if (state.failReadback && state.inspectCount === 2) throw new Error('Synthetic readback unavailable.');
    }
    if (command === 'run' && state.changeSourceBeforeRun) {
      const changed = JSON.parse(state.source);
      changed.untouched.value = '22k';
      state.source = JSON.stringify(changed);
    }
    let result = await runEditor(payload.code, command);
    if (command === 'run' && state.dropRunResponse) {
      res.destroy(); // Mutation happened, but the client cannot know its outcome.
      return;
    }
    if (command === 'drc') {
      if (state.incompleteDrc) result.diag.complete = false;
      if (state.staleDrc) result.diag.rerun = false;
      if (state.emptyDrc) {
        result.issues = []; result.text = '';
        result.diag = { complete: true, copied: 0, expected: 0, rerun: true };
      }
    }
    res.end(JSON.stringify({ success: true, result }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
});

let serial = 0, passed = 0, failed = 0;
async function test(name, action) {
  reset();
  try {
    await action();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + '\n' + error.stack);
  }
}

async function fixture(changes = {}) {
  const dir = path.join(temp, 'input-' + (++serial));
  await fs.mkdir(dir);
  const targetDocumentId = changes.documentId ?? documentId;
  const baseline = { document: { uuid: targetDocumentId, type: 'SCH_PAGE' },
    source: changes.source ?? originalSource };
  const inputBytes = changes.input ?? Buffer.from('\uFEFF' + JSON.stringify({
    kind: 'recorder', schemaVersion: 2, sessionId: 'synthetic-session',
    document: { uuid: targetDocumentId, type: 'SCH_PAGE' },
    events: [{ eventType: 'wire.modify', documentId: targetDocumentId, primitiveId: 'wire-1',
      before: { endpoint: 'earlier-pin' }, after: { endpoint: 'old-pin' } }],
    notes: [{ text: 'Historical note: inspect this wire; this is not the current request.' }],
    captureCoverage: { nativeEvents: true, pinResolution: 'available', finalSnapshotComplete: true },
    unknownFutureField: { preserved: true }
  }, null, 2) + '\r\n');
  const evidenceBytes = encode({ document: baseline.document, source: baseline.source,
    primitive: { id: 'wire-1', endpoint: 'old-pin' } });
  const normalized = parseInput(inputBytes);
  const plan = {
    schema: 'circuit-studio-repair-plan/v1',
    inputSha256: normalized.provenance.sha256, inputMode: normalized.mode,
    context: { userRequest: changes.userRequest ?? 'Connect wire-1 to new-pin; preserve resistor-2.',
      executionScope: 'authorized-repair' },
    goal: 'Connect wire-1 to new-pin.', preserve: ['Keep resistor-2 and its value unchanged.'],
    unresolved: [],
    steps: [{
      id: 'repair-wire', operation: 'ensure-connection', documentId: targetDocumentId,
      targets: [{ primitiveId: 'wire-1' }], desiredState: { endpoint: 'new-pin' },
      preconditions: ['The reviewed source matches the current document.'],
      evidence: [normalized.mode === 'text' ? 'T1' : 'E1'],
      intentBasis: 'explicit', confidence: 'high', disposition: 'ready',
      reason: 'The separate current request resolves the intended endpoint.',
      verify: ['Read wire-1 endpoint.', 'Check resistor-2 preservation.', 'Capture fresh complete DRC.'],
      liveEvidence: [{ file: 'live.json', sha256: sha256(evidenceBytes), pointer: '/primitive' }]
    }]
  };
  if (changes.changePlan) changes.changePlan(plan);
  if (changes.changeBaseline) changes.changeBaseline(baseline);
  const values = {
    'input.txt': inputBytes, 'plan.json': encode(plan),
    'patch.js': Buffer.from(changes.code ?? patch),
    'baseline.json': encode(baseline), 'live.json': evidenceBytes
  };
  for (const [file, bytes] of Object.entries(values)) await fs.writeFile(path.join(dir, file), bytes);
  return {
    dir, values, plan,
    options: { input: path.join(dir, 'input.txt'), plan: path.join(dir, 'plan.json'),
      step: 'repair-wire', code: path.join(dir, 'patch.js'), baseline: path.join(dir, 'baseline.json'),
      outDir: path.join(temp, 'round-' + serial), port: String(server.address().port) }
  };
}
const read = async (result, name) => fs.readFile(path.join(path.dirname(result.file), name));
const readJson = async (result, name) => decode(await read(result, name));
async function rewritePlan(f) { await fs.writeFile(f.options.plan, encode(f.plan)); }
async function editManifest(result, update) {
  const manifest = decode(await fs.readFile(result.file));
  await update(manifest);
  await fs.writeFile(result.file, encode(manifest));
}
async function replaceFixtureArtifact(result, file, value) {
  // Deliberately keep this fixture's per-file digest accurate so a test reaches
  // cross-record consistency validation, not merely the byte-tamper check.
  // This is not a claim that unsigned files resist wholesale hostile rewriting.
  const bytes = encode(value);
  await fs.writeFile(path.join(path.dirname(result.file), file), bytes);
  await editManifest(result, manifest => {
    const artifact = manifest.artifacts.find(item => item.file === file);
    artifact.sha256 = sha256(bytes);
    artifact.bytes = bytes.length;
  });
  return bytes;
}
async function linkedFixture() {
  const first = await fixture();
  const previous = await executeRound(first.options);
  const second = await fixture({ source: desiredSource });
  second.options.previous = previous.file;
  return executeRound(second.options);
}
async function rejected(f, expected) {
  await assert.rejects(executeRound(f.options), expected);
  assert.equal(state.writes, 0);
  assert.deepEqual(state.requests, [], 'Validation must fail before contacting the editor.');
  await assert.rejects(fs.access(f.options.outDir), { code: 'ENOENT' });
}
async function assertChecksIncomplete(result, drcStage) {
  assert.equal(result.record.status, 'executed-checks-incomplete');
  assert.equal(result.record.stages.drc, drcStage);
  assert.equal(state.writes, 1);
  const execution = await readJson(result, 'execution-result.json');
  assert.equal(execution.checks.requirements, 'not-assessed');
  assert.equal(execution.checks.preservation, 'not-assessed');
  await verifyRound(result.file);
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  await test('One local repair preserves exact input, separate request, code, before/after and checks', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    assert.equal(result.record.status, 'executed-awaiting-review');
    assert.deepEqual(state.calls, ['inspect', 'run', 'inspect', 'drc']);
    assert.equal(state.writes, 1);
    assert.equal(state.drcChecks, 1);
    for (const [archived, original] of [
      ['input.txt', 'input.txt'], ['repair-plan.json', 'plan.json'],
      ['patch.js', 'patch.js'], ['baseline.json', 'baseline.json'],
      ['live-evidence-1.bin', 'live.json']
    ]) assert.deepEqual(await read(result, archived), f.values[original]);
    assert.equal((await readJson(result, 'before.json')).source, originalSource);
    assert.equal((await readJson(result, 'after.json')).source, desiredSource);
    assert.deepEqual(JSON.parse(desiredSource).untouched, JSON.parse(originalSource).untouched);
    const execution = await readJson(result, 'execution-result.json');
    assert.equal(execution.userRequest, f.plan.context.userRequest);
    assert.equal(execution.checks.drcStatus, 'complete');
    assert.equal(execution.checks.requirements, 'not-assessed');
    assert.ok(execution.steps[0].verification.every(item => item.status === 'not-assessed'));
    assert.ok((await readJson(result, 'drc-after.json')).issues.some(row => row.severity === 'warning'));
    assert.match((await read(result, 'repair-prompt.md')).toString(), /Historical note/);
    assert.match((await read(result, 'repair-prompt.md')).toString(), /Connect wire-1 to new-pin/);
    const checked = await verifyRound(result.file);
    assert.equal(checked.sha256, sha256(await fs.readFile(result.file)));
  });

  await test('Existing output directory is rejected without overwriting history or contacting editor', async () => {
    const f = await fixture();
    await fs.mkdir(f.options.outDir);
    const marker = path.join(f.options.outDir, 'keep.txt');
    await fs.writeFile(marker, 'existing history');
    await assert.rejects(executeRound(f.options), { code: 'EEXIST' });
    assert.equal(await fs.readFile(marker, 'utf8'), 'existing history');
    assert.deepEqual(await fs.readdir(f.options.outDir), ['keep.txt']);
    assert.deepEqual(state.requests, []);
  });

  await test('Different active document blocks mutation and keeps a verifiable blocked record', async () => {
    const f = await fixture();
    state.documentId = 'different-page';
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'blocked');
    assert.equal(state.writes, 0);
    assert.deepEqual(state.calls, ['inspect']);
    await verifyRound(result.file);
  });

  await test('Current source differing from the reviewed baseline blocks mutation', async () => {
    const f = await fixture();
    state.source = source('conflicting-pin');
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'blocked');
    assert.equal(state.writes, 0);
    assert.deepEqual(state.calls, ['inspect']);
    assert.equal((await readJson(result, 'before.json')).source, state.source);
  });

  await test('Document switch during inspection is rejected before dispatching the patch', async () => {
    const f = await fixture();
    state.changeDocumentDuringInspect = true;
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'blocked');
    assert.equal(state.writes, 0);
    assert.deepEqual(state.calls, ['inspect']);
  });

  await test('Source change between preflight and run prevents patch execution without retry', async () => {
    const f = await fixture();
    state.changeSourceBeforeRun = true;
    const result = await executeRound(f.options);
    assert.equal(state.writes, 0, 'A conflicting edit must not be overwritten.');
    assert.equal(result.record.status, 'execution-unknown');
    assert.deepEqual(state.calls, ['inspect', 'run', 'inspect', 'drc']);
    assert.equal(JSON.parse(state.source).untouched.value, '22k');
    assert.equal(JSON.parse(state.source).wire.endpoint, 'old-pin');
  });

  await test('Baseline for a different document is rejected before editor access', async () => {
    await rejected(await fixture({ changeBaseline: baseline => { baseline.document.uuid = 'different-page'; } }),
      /Baseline.*matching document/);
  });

  await test('Missing local live evidence prevents execution', async () => {
    const f = await fixture();
    f.plan.steps[0].liveEvidence[0].file = 'missing-evidence.json';
    await rewritePlan(f);
    await rejected(f, /Cannot read live evidence/);
  });

  await test('Stale live evidence bytes cannot satisfy a previous content hash', async () => {
    const f = await fixture();
    await fs.appendFile(path.join(f.dir, 'live.json'), ' ');
    await rejected(f, /SHA-256 mismatch/);
  });

  await test('Missing live JSON pointer prevents execution even with a correct file hash', async () => {
    const f = await fixture();
    f.plan.steps[0].liveEvidence[0].pointer = '/missing/primitive';
    await rewritePlan(f);
    await rejected(f, /pointer not found/);
  });

  await test('Partial pasted evidence cannot execute without a current live reference', async () => {
    await rejected(await fixture({ input: Buffer.from('A pasted note about wire-1.'),
      changePlan: plan => { delete plan.steps[0].liveEvidence; } }), /Partial text/);
  });

  await test('Changed report bytes invalidate the bound plan before execution', async () => {
    const f = await fixture();
    await fs.appendFile(f.options.input, ' ');
    await rejected(f, /different export/);
  });

  await test('Malformed Agent JavaScript is rejected before editor access', async () => {
    await rejected(await fixture({ code: 'return (' }), SyntaxError);
  });

  await test('Analysis-only scope cannot dispatch even a structurally ready step', async () => {
    await rejected(await fixture({ changePlan: plan => { plan.context.executionScope = 'analysis-only'; } }),
      /authorization|executionScope/);
  });

  for (const disposition of ['inspect', 'already-satisfied', 'needs-input']) {
    await test(disposition + ' step cannot dispatch a mutation', async () => {
      await rejected(await fixture({ changePlan: plan => {
        plan.steps[0].disposition = disposition;
        if (disposition === 'needs-input') plan.unresolved.push({
          question: 'Which endpoint is intended?', stepIds: ['repair-wire']
        });
      } }), /ready step/);
    });
  }

  await test('Missing separate current user request prevents execution', async () => {
    await rejected(await fixture({ changePlan: plan => { delete plan.context.userRequest; } }),
      /context.userRequest/);
  });

  await test('Continuation links the prior round while preserving both independent requests', async () => {
    const first = await fixture(), previous = await executeRound(first.options);
    const previousBytes = await fs.readFile(previous.file);
    const second = await fixture({ source: desiredSource,
      userRequest: 'Confirm wire-1 remains on new-pin and preserve the prior repair.' });
    second.options.previous = previous.file;
    const next = await executeRound(second.options);
    assert.equal(next.record.previousRoundId, previous.record.roundId);
    assert.equal(next.record.previousManifest.sha256, sha256(previousBytes));
    assert.deepEqual(await read(next, 'previous-round.json'), previousBytes);
    assert.deepEqual(await fs.readFile(previous.file), previousBytes);
    assert.equal((await readJson(next, 'execution-result.json')).userRequest, second.plan.context.userRequest);
    assert.equal((await readJson(previous, 'execution-result.json')).userRequest, first.plan.context.userRequest);
    assert.equal((await readJson(next, 'bridge-result.json')).returned.status, 'already-satisfied');
    assert.equal(state.writes, 1, 'Continuation must not replay the already-satisfied mutation.');
    await verifyRound(previous.file);
    await verifyRound(next.file);
  });

  await test('A prior round for another document cannot be linked', async () => {
    state.documentId = 'different-page';
    const first = await fixture({ documentId: 'different-page' });
    const previous = await executeRound(first.options);
    await verifyRound(previous.file);
    reset();
    const next = await fixture();
    next.options.previous = previous.file;
    await assert.rejects(executeRound(next.options), /different document/);
    assert.equal(state.writes, 0);
    assert.deepEqual(state.requests, []);
  });

  await test('Tampered prior artifacts are detected before a continuation can execute', async () => {
    const first = await fixture(), previous = await executeRound(first.options);
    await fs.appendFile(path.join(path.dirname(previous.file), 'patch.js'), '// tampered\n');
    await assert.rejects(verifyRound(previous.file), /Artifact changed/);
    reset();
    const next = await fixture();
    next.options.previous = previous.file;
    await rejected(next, /Artifact changed/);
  });

  await test('Round verification rejects artifact paths escaping the round directory', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    const manifest = decode(await fs.readFile(result.file));
    manifest.artifacts[0].file = '../outside.txt';
    await fs.writeFile(result.file, encode(manifest));
    await assert.rejects(verifyRound(result.file), /Unsafe|outside/);
  });

  await test('Round verification rejects duplicated artifact paths', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    const manifest = decode(await fs.readFile(result.file));
    manifest.artifacts.push(manifest.artifacts[0]);
    await fs.writeFile(result.file, encode(manifest));
    await assert.rejects(verifyRound(result.file), /duplicate/i);
  });

  await test('Round verification rejects a manifest omitting a required retained artifact', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    const manifest = decode(await fs.readFile(result.file));
    manifest.artifacts = manifest.artifacts.filter(item => item.file !== 'patch.js');
    await fs.writeFile(result.file, encode(manifest));
    await assert.rejects(verifyRound(result.file), /Missing round artifact/);
  });

  for (const field of ['inputSha256', 'planSha256', 'codeSha256']) {
    await test('Manifest ' + field + ' must match the actual archived bytes', async () => {
      const f = await fixture(), result = await executeRound(f.options);
      await editManifest(result, manifest => { manifest[field] = '0'.repeat(64); });
      await assert.rejects(verifyRound(result.file), new RegExp('metadata hash mismatch: ' + field));
    });
  }

  for (const field of ['documentId', 'stepId']) {
    await test('Manifest ' + field + ' must identify the selected archived plan step', async () => {
      const f = await fixture(), result = await executeRound(f.options);
      await editManifest(result, manifest => { manifest[field] = 'different-' + field; });
      await assert.rejects(verifyRound(result.file), /does not match plan\/baseline document/);
    });
  }

  for (const field of ['roundId', 'documentId', 'inputSha256', 'status']) {
    await test('Archived execution result ' + field + ' must agree with the manifest', async () => {
      const f = await fixture(), result = await executeRound(f.options);
      const execution = await readJson(result, 'execution-result.json');
      execution[field] = field === 'inputSha256' ? '0'.repeat(64)
        : field === 'status' ? 'blocked' : 'different-' + field;
      await replaceFixtureArtifact(result, 'execution-result.json', execution);
      await assert.rejects(verifyRound(result.file), new RegExp('Execution result metadata mismatch: ' + field));
    });
  }

  await test('Archived baseline document must agree even when its file digest is accurate', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    const baseline = await readJson(result, 'baseline.json');
    baseline.document.uuid = 'different-page';
    await replaceFixtureArtifact(result, 'baseline.json', baseline);
    await assert.rejects(verifyRound(result.file), /does not match plan\/baseline document/);
  });

  await test('Archived input and plan are revalidated for exact report binding', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    const plan = await readJson(result, 'repair-plan.json');
    plan.inputSha256 = '0'.repeat(64);
    const bytes = await replaceFixtureArtifact(result, 'repair-plan.json', plan);
    await editManifest(result, manifest => { manifest.planSha256 = sha256(bytes); });
    await assert.rejects(verifyRound(result.file), /different export/);
  });

  await test('Archived plan validation rejects nonexistent report evidence references', async () => {
    const f = await fixture(), result = await executeRound(f.options);
    const plan = await readJson(result, 'repair-plan.json');
    plan.steps[0].evidence = ['E999'];
    const bytes = await replaceFixtureArtifact(result, 'repair-plan.json', plan);
    await editManifest(result, manifest => { manifest.planSha256 = sha256(bytes); });
    await assert.rejects(verifyRound(result.file), /Unknown evidence ID/);
  });

  await test('Previous round ID must match the archived predecessor identity', async () => {
    const result = await linkedFixture();
    await editManifest(result, manifest => { manifest.previousRoundId = 'different-round'; });
    await assert.rejects(verifyRound(result.file), /Previous round identity mismatch/);
  });

  await test('Previous manifest hash must match the retained predecessor bytes', async () => {
    const result = await linkedFixture();
    await editManifest(result, manifest => { manifest.previousManifest.sha256 = '0'.repeat(64); });
    await assert.rejects(verifyRound(result.file), /Previous manifest hash mismatch/);
  });

  await test('A linked predecessor cannot silently be removed from the artifact manifest', async () => {
    const result = await linkedFixture();
    await editManifest(result, manifest => {
      manifest.artifacts = manifest.artifacts.filter(item => item.file !== 'previous-round.json');
    });
    await assert.rejects(verifyRound(result.file), /Previous manifest hash mismatch/);
  });

  await test('Clearing previous metadata cannot hide an archived predecessor', async () => {
    const result = await linkedFixture();
    await editManifest(result, manifest => {
      manifest.previousRoundId = null;
      manifest.previousManifest = null;
    });
    await assert.rejects(verifyRound(result.file), /Unexpected previous round metadata/);
  });

  await test('Archived predecessor document must match the current round', async () => {
    const result = await linkedFixture();
    const previous = await readJson(result, 'previous-round.json');
    previous.documentId = 'different-page';
    const bytes = await replaceFixtureArtifact(result, 'previous-round.json', previous);
    await editManifest(result, manifest => { manifest.previousManifest.sha256 = sha256(bytes); });
    await assert.rejects(verifyRound(result.file), /Previous round identity mismatch/);
  });

  await test('Lost mutation response triggers readback and DRC exactly once without retry', async () => {
    const f = await fixture();
    state.dropRunResponse = true;
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'execution-unknown');
    assert.equal(result.record.stages.execution, 'unknown');
    assert.equal(result.record.stages.readback, 'captured');
    assert.equal(result.record.stages.drc, 'captured');
    assert.deepEqual(state.calls, ['inspect', 'run', 'inspect', 'drc']);
    assert.equal(state.writes, 1);
    assert.equal((await readJson(result, 'after.json')).source, desiredSource);
    await verifyRound(result.file);
  });

  await test('Exception after a mutation remains uncertain and still receives readback and DRC', async () => {
    const f = await fixture();
    state.throwAfterWrite = true;
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'execution-unknown');
    assert.deepEqual(state.calls, ['inspect', 'run', 'inspect', 'drc']);
    assert.equal(state.writes, 1);
    assert.equal((await readJson(result, 'after.json')).source, desiredSource);
    assert.equal(result.record.stages.drc, 'captured');
  });

  await test('Readback failure still attempts independent DRC and retains an incomplete outcome', async () => {
    const f = await fixture();
    state.failReadback = true;
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'executed-checks-incomplete');
    assert.equal(result.record.stages.readback, 'failed');
    assert.equal(result.record.stages.drc, 'captured');
    assert.deepEqual(state.calls, ['inspect', 'run', 'inspect', 'drc']);
    assert.equal(state.writes, 1);
    await verifyRound(result.file);
  });

  await test('Document switch after mutation prevents checks from inspecting another document', async () => {
    const f = await fixture();
    state.switchDocumentAfterWrite = true;
    const result = await executeRound(f.options);
    assert.equal(result.record.status, 'executed-checks-incomplete');
    assert.equal(result.record.stages.readback, 'failed');
    assert.equal(result.record.stages.drc, 'failed');
    assert.equal(state.drcChecks, 0);
    assert.equal(state.writes, 1);
  });

  await test('A failed fresh DRC is recorded as failed without retrying the repair', async () => {
    const f = await fixture();
    state.drcFailure = true;
    const result = await executeRound(f.options);
    await assertChecksIncomplete(result, 'failed');
    assert.equal(state.drcChecks, 1);
    assert.deepEqual(state.calls, ['inspect', 'run', 'inspect', 'drc']);
    assert.match(JSON.stringify(result.record.errors), /Synthetic DRC failed/);
  });

  await test('Incomplete DRC capture cannot be promoted to a completed check', async () => {
    const f = await fixture();
    state.incompleteDrc = true;
    const result = await executeRound(f.options);
    await assertChecksIncomplete(result, 'incomplete');
    assert.equal((await readJson(result, 'execution-result.json')).checks.drcStatus, 'unverified');
  });

  await test('An empty DRC panel is retained as empty, never interpreted as zero defects', async () => {
    const f = await fixture();
    state.emptyDrc = true;
    const result = await executeRound(f.options);
    await assertChecksIncomplete(result, 'incomplete');
    assert.equal((await readJson(result, 'execution-result.json')).checks.drcStatus, 'empty');
  });

  await test('Complete stale DRC rows cannot satisfy a fresh check requirement', async () => {
    const f = await fixture();
    state.staleDrc = true;
    await assertChecksIncomplete(await executeRound(f.options), 'incomplete');
  });
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(temp);
  const real = await fs.realpath(resolved);
  assert.equal(path.dirname(resolved), tempRoot, 'Refuse cleanup outside the intended temporary root.');
  assert.equal(path.dirname(real), tempRoot, 'Refuse cleanup through a redirected temporary directory.');
  assert.ok(path.basename(real).startsWith('circuit-round-check-'), 'Refuse cleanup of an unexpected directory.');
  await fs.rm(real, { recursive: true, force: true });
}

console.log(`${passed} checks passed; ${failed} failed. Only synthetic temporary files and a loopback mock editor were used.`);
if (failed) process.exitCode = 1;
