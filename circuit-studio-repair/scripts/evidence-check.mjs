import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compile, parseInput, sha256, verifyLiveEvidence } from './report.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'circuit-evidence-check-'));
const plans = path.join(temp, 'plans');
const snapshot = path.join(plans, 'snapshot.json');
const raw = Buffer.from('{"state":null,"items":[{"id":"wire-1"}],"a/b":{"~key":false},"":{"0":0},"~1":"escaped","__proto__":{"own":true}}');
const ref = (pointer = '', extra = {}) => ({ file: 'snapshot.json', sha256: sha256(raw), pointer, ...extra });
const planWith = refs => ({ steps: [{ id: 'step-1', liveEvidence: refs }] });
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function verify(pointer, extra = {}) { return verifyLiveEvidence(planWith([ref(pointer, extra)]), plans); }

try {
  await fs.mkdir(plans);
  await fs.writeFile(snapshot, raw);
  await test('Relative references resolve against the plan directory and return actual hashes', async () => {
    const result = await verify('/items/0/id', { sha256: sha256(raw).toUpperCase() });
    assert.deepEqual(result, [{ file: snapshot, sha256: sha256(raw), pointer: '/items/0/id', stepId: 'step-1' }]);
    assert.deepEqual(await verifyLiveEvidence({ steps: [{ id: 'old-plan-step' }] }, plans), []);
  });
  await test('Existing null, false, zero and escaped keys are valid pointer targets', async () => {
    for (const pointer of ['/state', '/a~1b/~0key', '//0', '/~01', '/__proto__/own']) await verify(pointer);
    await assert.rejects(() => verify('/missing'), /pointer not found/);
    await assert.rejects(() => verify('/state/child'), /pointer not found/);
  });
  await test('Inherited properties and noncanonical or absent array indices are rejected', async () => {
    for (const pointer of ['/constructor', '/toString', '/items/0/constructor']) {
      await assert.rejects(() => verify(pointer), /pointer not found/);
    }
    for (const pointer of ['/items/01', '/items/-1', '/items/-', '/items/length', '/items/1.0']) {
      await assert.rejects(() => verify(pointer), /array index/);
    }
    await assert.rejects(() => verify('/items/1'), /pointer not found/);
  });
  await test('Pointer syntax, missing files and mismatched hashes fail explicitly', async () => {
    for (const pointer of ['state', '/bad~2', '/bad~', '/bad~01~']) {
      await assert.rejects(() => verify(pointer), /Invalid live evidence pointer/);
    }
    await assert.rejects(() => verify('', { file: 'missing.json' }), /Cannot read live evidence file/);
    await assert.rejects(() => verify('', { sha256: '0'.repeat(64) }), /SHA-256 mismatch/);
    await assert.rejects(() => verify('', { sha256: 'not-a-hash' }), /needs a SHA-256/);
  });
  await test('Whole-file references need a matching byte hash but do not require JSON', async () => {
    const bytes = Buffer.from('Plain text evidence.\n');
    await fs.writeFile(path.join(plans, 'evidence.txt'), bytes);
    await verify('', { file: 'evidence.txt', sha256: sha256(bytes) });
    await assert.rejects(() => verify('/state', { file: 'evidence.txt', sha256: sha256(bytes) }), /requires valid JSON/);
    await fs.writeFile(snapshot, Buffer.concat([raw, Buffer.from('\n')]));
    await assert.rejects(() => verify('/state'), /SHA-256 mismatch/);
    await fs.writeFile(snapshot, raw);
  });
  await test('Every step reference is verified, including a later missing file', async () => {
    await assert.rejects(() => verifyLiveEvidence({ steps: [
      { id: 'first', liveEvidence: [ref('/state')] },
      { id: 'second', liveEvidence: [ref('', { file: 'missing.json' })] }
    ] }, plans), /Cannot read live evidence file/);
  });
  await test('CLI compile verifies plan-relative evidence before writing and preserves failed output', async () => {
    const input = Buffer.from('Inspect the current schematic.');
    const n = parseInput(input);
    const plan = {
      schema: 'circuit-studio-repair-plan/v1', inputSha256: n.provenance.sha256, inputMode: n.mode,
      goal: 'Inspect the recorded wire.', preserve: [], unresolved: [], context: { executionScope: 'analysis-only' },
      steps: [{ id: 'step-1', operation: 'inspect', documentId: null, targets: [], desiredState: {},
        preconditions: [], evidence: ['T1'], confidence: 'low', disposition: 'inspect', reason: 'Read-only check.',
        verify: [], liveEvidence: [ref('/items/0/id')] }]
    };
    const inputFile = path.join(temp, 'input.txt'), planFile = path.join(plans, 'plan.json'), output = path.join(temp, 'prompt.md');
    const cli = fileURLToPath(new URL('./report.mjs', import.meta.url));
    await fs.writeFile(inputFile, input);
    await fs.writeFile(planFile, JSON.stringify(plan));
    const run = out => spawnSync(process.execPath, [cli, 'compile', inputFile, planFile, out], { cwd: temp, encoding: 'utf8' });
    let result = run(output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(await fs.readFile(output, 'utf8'), /Circuit Studio analysis prompt/);
    assert.equal(run(snapshot).status, 1);
    assert.deepEqual(await fs.readFile(snapshot), raw);
    await fs.writeFile(output, 'keep existing output');
    await fs.writeFile(snapshot, Buffer.concat([raw, Buffer.from(' ')]));
    assert.equal(typeof compile(plan, n), 'string'); // The synchronous API remains structural.
    result = run(output);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SHA-256 mismatch/);
    assert.equal(await fs.readFile(output, 'utf8'), 'keep existing output');
    await fs.writeFile(snapshot, raw);
    delete plan.steps[0].liveEvidence;
    await fs.writeFile(planFile, JSON.stringify(plan));
    result = run(output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 0 live evidence references/);
  });
  console.log('All ' + passed + ' live evidence checks passed.');
} finally {
  const resolved = path.resolve(temp);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('circuit-evidence-check-'));
  await fs.rm(resolved, { recursive: true, force: true });
}
