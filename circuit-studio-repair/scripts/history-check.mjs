import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initHistory, recordReport, loadHistoryContext, writeHistoryContext,
  verifyHistoryReview, appendRound, prepareRollback, lockHistory
} from './history.mjs';
import { parseInput, sha256 } from './report.mjs';

// File-only checks: all reports, requests and code are synthetic. No editor,
// Bridge, network service, model, or real participant data is used.
const tempRoot = await fs.realpath(os.tmpdir());
const temp = await fs.mkdtemp(path.join(tempRoot, 'circuit-history-check-'));
const scope = { projectId: 'synthetic-project', documentId: 'synthetic-document' };
const stamp = '2026-10-01T10:00:00.000Z';
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
let serial = 0, passed = 0, failed = 0;

const lint = () => ({
  kind: 'lint', schemaVersion: 2, document: { uuid: scope.documentId }, exportedAt: stamp,
  issues: [
    { index: 0, rawText: 'Synthetic DRC starts.', severity: 'info' },
    { index: 1, rawText: 'Synthetic DRC finishes.', severity: 'info', isSummary: true }
  ],
  text: 'Synthetic DRC starts.\nSynthetic DRC finishes.',
  diag: { complete: true, copied: 2, expected: 2 }
});
const report = mode => {
  if (mode === 'lint') return lint();
  const value = {
    kind: mode, schemaVersion: 2, sessionId: 'synthetic-session', exportedAt: stamp,
    document: { uuid: scope.documentId },
    events: [{ eventType: 'wire.modify', at: stamp, primitiveId: 'wire-1',
      before: { endpoint: 'earlier-pin' }, after: { endpoint: 'observed-pin' } }],
    notes: [{ at: stamp, text: 'An earlier note is evidence, not the current instruction.' }],
    captureCoverage: { nativeEvents: true, pinResolution: 'available', finalSnapshotComplete: true },
    unknownFutureField: { exactPreservation: ['keep', 7] }
  };
  if (mode === 'hybrid') {
    value.status = 'complete'; value.recording = false;
    value.lint = { ...lint(), status: 'complete', diag: { ...lint().diag, rerun: true } };
  }
  return value;
};
const request = () => ({
  userRequest: 'Connect wire-1 to confirmed-pin; keep resistor-2 unchanged.',
  goal: 'Restore the confirmed connection.',
  clarifications: [{ id: 'Q1', question: 'Which endpoint is intended?',
    answer: 'confirmed-pin', at: '2026-10-01T10:02:00.000Z' }]
});

async function fixture(mode = 'recorder') {
  const dir = path.join(temp, 'case-' + (++serial));
  const history = path.join(dir, 'history');
  await fs.mkdir(dir);
  await initHistory(history, scope);
  const input = path.join(dir, 'export.json');
  const raw = Buffer.from('\uFEFF' + JSON.stringify(report(mode), null, 2) + '\r\n');
  await fs.writeFile(input, raw);
  return { dir, history, input, raw, context: request() };
}
async function recorded(mode) {
  const f = await fixture(mode);
  f.event = await recordReport(f.history, { input: f.input, context: f.context });
  return f;
}
async function reviewed(mode) {
  const f = await recorded(mode);
  f.reference = await writeHistoryContext(f.history, path.join(f.dir, 'review.json'));
  f.plan = { inputSha256: sha256(f.raw), goal: f.context.goal,
    context: { userRequest: f.context.userRequest, history: { ...f.reference } } };
  return f;
}
const indexBytes = f => fs.readFile(path.join(f.history, 'history.json'));
async function test(name, action) {
  try { await action(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

try {
  await test('History initialization requires explicit scope and cannot replace an existing index', async () => {
    const f = await fixture(), before = await indexBytes(f);
    await assert.rejects(initHistory(f.history, { ...scope, documentId: 'another-document' }), { code: 'EEXIST' });
    assert.deepEqual(await indexBytes(f), before);
    await assert.rejects(initHistory(path.join(f.dir, 'unscoped'), { documentId: scope.documentId }), /projectId/);
    await assert.rejects(fs.access(path.join(f.dir, 'unscoped')), { code: 'ENOENT' });
  });

  for (const mode of ['lint', 'recorder', 'hybrid']) {
    await test(mode + ' preserves original bytes, provenance and separate clarification evidence', async () => {
      const f = await recorded(mode), context = await loadHistoryContext(f.history);
      const entry = context.entries[0], artifacts = entry.artifacts;
      assert.equal(context.projectId, scope.projectId);
      assert.equal(context.documentId, scope.documentId);
      assert.equal(entry.mode, mode);
      assert.equal(entry.previousId, null);
      assert.ok(Number.isFinite(Date.parse(entry.recordedAt)));
      assert.deepEqual(await fs.readFile(artifacts['input.txt'].file), f.raw);
      assert.deepEqual(await fs.readFile(f.input), f.raw);
      assert.equal(artifacts['input.txt'].sha256, sha256(f.raw));
      const evidence = JSON.parse(artifacts['evidence.json'].content);
      assert.equal(evidence.mode, mode);
      assert.equal(evidence.provenance.sha256, sha256(f.raw));
      assert.equal(evidence.provenance.path, path.resolve(f.input));
      assert.deepEqual(evidence.report, parseInput(f.raw).report);
      assert.equal(Object.hasOwn(evidence.report, 'clarifications'), false);
      assert.deepEqual(JSON.parse(artifacts['request.json'].content), f.context);
      assert.equal(context.currentRequest.userRequest, f.context.userRequest);
      assert.equal(context.currentRequest.clarifications[0].at, f.context.clarifications[0].at);
      assert.equal(context.currentRequest.inputSha256, sha256(f.raw));
    });
  }

  await test('Successive modes retain earlier requests while the current request follows the newest report', async () => {
    const f = await recorded('lint'), first = await loadHistoryContext(f.history);
    const firstBytes = await fs.readFile(first.entries[0].artifacts['request.json'].file);
    const next = { ...request(), userRequest: 'Keep the earlier connection; only inspect the new note.',
      goal: 'Inspect without changing the connection.' };
    const secondInput = path.join(f.dir, 'hybrid.json');
    await fs.writeFile(secondInput, encode(report('hybrid')));
    const event = await recordReport(f.history, { input: secondInput, context: next });
    const context = await loadHistoryContext(f.history);
    assert.deepEqual(context.entries.map(e => e.mode), ['lint', 'hybrid']);
    assert.equal(event.previousId, first.headId);
    assert.equal(context.headId, event.id);
    assert.equal(context.currentRequest.userRequest, next.userRequest);
    assert.deepEqual(await fs.readFile(context.entries[0].artifacts['request.json'].file), firstBytes);
  });

  await test('Historical generation code is archived exactly without being treated as an executed patch', async () => {
    const f = await fixture(), code = path.join(f.dir, 'initial.js');
    const bytes = Buffer.from('// Synthetic historical code.\r\nthrow new Error("must never execute");\r\n');
    await fs.writeFile(code, bytes);
    const event = await recordReport(f.history, { input: f.input, context: f.context, generationCode: code });
    const entry = (await loadHistoryContext(f.history)).entries[0];
    assert.deepEqual(await fs.readFile(entry.artifacts['supplied-generation.js'].file), bytes);
    assert.equal(event.type, 'report');
    assert.equal(event.roundId, undefined);
    assert.equal(event.status, undefined);
    assert.match(event.generationCode.provenance, /execution not established/);
  });

  await test('Plain pasted evidence remains usable without inventing document identity inside its raw payload', async () => {
    const f = await fixture(), bytes = Buffer.from('Move the selected wire?\r\nThe endpoint is not known.\r\n');
    await fs.writeFile(f.input, bytes);
    await recordReport(f.history, { input: f.input, context: f.context });
    const saved = (await loadHistoryContext(f.history)).entries[0];
    assert.equal(saved.mode, 'text');
    assert.deepEqual(await fs.readFile(saved.artifacts['input.txt'].file), bytes);
    assert.equal(JSON.parse(saved.artifacts['evidence.json'].content).report.document, undefined);
  });

  await test('Context generation is deterministic and does not overwrite a reviewed context file', async () => {
    const f = await recorded();
    assert.deepEqual(await loadHistoryContext(f.history), await loadHistoryContext(f.history));
    const file = path.join(f.dir, 'context.json');
    const ref = await writeHistoryContext(f.history, file), before = await fs.readFile(file);
    assert.equal(ref.sha256, sha256(before));
    assert.equal(ref.file, path.resolve(file));
    await assert.rejects(writeHistoryContext(f.history, file), { code: 'EEXIST' });
    assert.deepEqual(await fs.readFile(file), before);
  });

  await test('An empty history cannot be presented as a reviewed current report', async () => {
    const f = await fixture();
    await assert.rejects(writeHistoryContext(f.history, path.join(f.dir, 'context.json')), /current report/);
  });

  await test('A valid review binds the exact report, current request, goal and selected document', async () => {
    const f = await reviewed();
    f.plan.context.history.file = path.relative(f.dir, f.reference.file);
    const result = await verifyHistoryReview(f.plan, f.dir, scope.documentId);
    assert.equal(result.context.headId, f.event.id);
    assert.equal(result.reference.file, f.reference.file);
    assert.equal(result.context.currentRequest.inputSha256, f.plan.inputSha256);
  });

  await test('A newly recorded report makes an earlier history review stale', async () => {
    const f = await reviewed();
    await recordReport(f.history, { input: f.input, context: { ...f.context, userRequest: 'Use another endpoint.' } });
    await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /stale|changed/);
  });

  await test('Changing the saved context bytes invalidates its recorded digest', async () => {
    const f = await reviewed();
    await fs.appendFile(f.reference.file, '\n');
    await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /SHA-256 mismatch/);
  });

  await test('Editing context content and updating its digest still cannot override archived history', async () => {
    const f = await reviewed(), context = decode(await fs.readFile(f.reference.file));
    context.currentRequest.userRequest = 'An invented replacement request.';
    const bytes = encode(context);
    await fs.writeFile(f.reference.file, bytes);
    f.plan.context.history.sha256 = sha256(bytes);
    await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /stale|changed/);
  });

  for (const field of ['projectId', 'documentId', 'headId']) {
    await test('Review rejects an incorrect ' + field, async () => {
      const f = await reviewed();
      f.plan.context.history[field] = 'wrong-' + field;
      await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /scope\/head mismatch/);
    });
  }

  await test('Review rejects another selected document even with an otherwise valid reference', async () => {
    const f = await reviewed();
    await assert.rejects(verifyHistoryReview(f.plan, f.dir, 'different-document'), /scope\/head mismatch/);
  });

  for (const field of ['userRequest', 'goal', 'inputSha256']) {
    await test('Review rejects a changed current ' + field, async () => {
      const f = await reviewed();
      if (field === 'userRequest') f.plan.context.userRequest = 'Changed request.';
      else f.plan[field] = 'changed';
      await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /does not match/);
    });
  }

  await test('Review requires a history reference before accepting a plan', async () => {
    const f = await reviewed();
    delete f.plan.context.history;
    await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /Missing reviewed/);
  });

  await test('Changing archived raw evidence is detected before history can be reviewed', async () => {
    const f = await reviewed(), context = await loadHistoryContext(f.history);
    await fs.appendFile(context.entries[0].artifacts['input.txt'].file, '\n');
    await assert.rejects(loadHistoryContext(f.history), /artifact changed/);
    await assert.rejects(verifyHistoryReview(f.plan, f.dir, scope.documentId), /artifact changed/);
  });

  await test('Changing entry metadata or the history scope breaks the retained chain', async () => {
    const f = await recorded();
    const index = decode(await indexBytes(f));
    index.documentId = 'another-document';
    await fs.writeFile(path.join(f.history, 'history.json'), encode(index));
    await assert.rejects(loadHistoryContext(f.history), /scope or chain mismatch/);
  });

  await test('Changing an entry file is detected independently of its raw evidence files', async () => {
    const f = await recorded();
    await fs.appendFile(path.join(f.history, f.event.id, 'entry.json'), '\n');
    await assert.rejects(loadHistoryContext(f.history), /entry hash mismatch/);
  });

  await test('A report from another document cannot advance the current history', async () => {
    const f = await recorded(), before = await indexBytes(f), wrong = report('recorder');
    wrong.document.uuid = 'different-document';
    await fs.writeFile(f.input, encode(wrong));
    await assert.rejects(recordReport(f.history, { input: f.input, context: f.context }), /different document/);
    assert.deepEqual(await indexBytes(f), before);
    // Rejection must release its lock so a subsequent valid import can proceed.
    await fs.writeFile(f.input, f.raw);
    await recordReport(f.history, { input: f.input, context: f.context });
    assert.equal((await loadHistoryContext(f.history)).entries.length, 2);
  });

  await test('Clarification records require unique IDs, explicit answers and valid times', async () => {
    const f = await fixture(), before = await indexBytes(f);
    const cases = [
      { ...request(), clarifications: [request().clarifications[0], request().clarifications[0]] },
      { ...request(), clarifications: [{ ...request().clarifications[0], at: 'not-a-date' }] },
      { ...request(), clarifications: [{ ...request().clarifications[0], answer: '' }] }
    ];
    for (const context of cases) await assert.rejects(recordReport(f.history, { input: f.input, context }), /clarification|Invalid/);
    assert.deepEqual(await indexBytes(f), before);
  });

  await test('A busy history prevents concurrent imports without overwriting its index', async () => {
    const f = await fixture(), before = await indexBytes(f), release = await lockHistory(f.history);
    try {
      await assert.rejects(recordReport(f.history, { input: f.input, context: f.context }), /History is in use/);
      assert.deepEqual(await indexBytes(f), before);
    } finally { await release(); }
    await recordReport(f.history, { input: f.input, context: f.context });
  });

  await test('An invalid execution manifest cannot be imported as a completed round', async () => {
    const f = await recorded(), file = path.join(f.dir, 'invalid-round.json'), before = await indexBytes(f);
    await fs.writeFile(file, encode({ schema: 'circuit-studio-round/v1', artifacts: [] }));
    await assert.rejects(appendRound(f.history, file), /Invalid round/);
    assert.deepEqual(await indexBytes(f), before);
  });

  await test('A report-only history cannot supply a rollback target or imply an executed change', async () => {
    const f = await recorded();
    const baseline = path.join(f.dir, 'baseline.json');
    await fs.writeFile(baseline, encode({ document: { uuid: scope.documentId }, source: '{}' }));
    const before = await indexBytes(f);
    await assert.rejects(prepareRollback(f.history, { roundId: f.event.id, baseline }), /not in this history/);
    assert.deepEqual(await indexBytes(f), before);
  });
} finally {
  const resolved = path.resolve(temp), real = await fs.realpath(resolved);
  assert.equal(path.dirname(resolved), tempRoot, 'Refuse cleanup outside the intended temporary root.');
  assert.equal(path.dirname(real), tempRoot, 'Refuse cleanup through a redirected temporary directory.');
  assert.ok(path.basename(real).startsWith('circuit-history-check-'), 'Refuse cleanup of an unexpected directory.');
  await fs.rm(real, { recursive: true, force: true });
}

console.log(`${passed} checks passed; ${failed} failed. Only synthetic temporary files were used.`);
if (failed) process.exitCode = 1;
