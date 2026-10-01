// Run: node hybrid-check.mjs. Deterministic Node assertions, no dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const hybridSource = readFileSync(new URL('./hybrid.js', import.meta.url), 'utf8');
const lintSource = readFileSync(new URL('./linter.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0;
async function check(name, run) {
  await run();
  checks++;
  console.log('PASS ' + name);
}

function hybridEnvironment(runLint) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-21T12:01:00.000Z'])); }
  }
  const context = vm.createContext({
    Date: FixedDate,
    CircuitStudioLinter: { runLint },
    __csLastLintDiag: { source: 'panel-mirror', complete: true, copied: 4, expected: 4, rerun: true }
  });
  vm.runInContext(hybridSource, context);
  return context.CircuitStudioHybrid.finalizeHybrid;
}

function recordingFixture() {
  return {
    sessionId: 'recording-test',
    events: [
      { kind: 'modify', time: '2026-09-21T12:00:03.000Z', seq: 3, raw: { object: { x: 20 } } },
      { kind: 'create', time: '2026-09-21T12:00:01.000Z', seq: 1 }
    ],
    rawEvents: [{ type: 'wire-connected', payload: { pin: 'U1.2', wire: 'wire-1' } }],
    captureCoverage: { native: true, snapshots: true, unsupported: ['unavailable-api'] },
    stop: async () => {},
    buildLog() {
      return { sessionId: this.sessionId, events: this.events,
        rawEvents: this.rawEvents, captureCoverage: this.captureCoverage };
    }
  };
}

const lintRows = [
  { index: 0, severity: 'info', rawText: '2026-09-21 12:01:00\n[信息] : 开始设计规则检查' },
  { index: 1, severity: 'error', rawText: '2026-09-21 12:01:00\n[错误] :  U1.2 未连接\n  <tag>&\t' },
  { index: 2, severity: 'error', rawText: '2026-09-21 12:01:00\n[错误] :  U1.2 未连接\n  <tag>&\t' },
  { index: 3, severity: 'info', isSummary: true, rawText: '2026-09-21 12:01:00\n[信息] : 完成设计规则检查' }
];

await check('Hybrid waits for asynchronous stop and includes the last recording/native event', async () => {
  const recorder = recordingFixture();
  const order = [];
  let finishStop;
  recorder.stop = async () => {
    order.push('stop-start');
    await new Promise(resolve => { finishStop = resolve; });
    recorder.events.push({ kind: 'connect', time: '2026-09-21T12:00:04.000Z', seq: 4 });
    recorder.rawEvents.push({ type: 'final-native-change', payload: { pin: 'U1.3' } });
    order.push('stop-finished');
  };
  const finalize = hybridEnvironment(async options => {
    order.push('lint');
    assert.deepEqual(order, ['stop-start', 'stop-finished', 'lint']);
    assert.equal(options.rerun, true);
    options.progress(4, 4);
    return lintRows;
  });
  const progress = [];
  const pending = finalize(recorder, { progress: (...args) => progress.push(args) });
  await Promise.resolve();
  assert.deepEqual(order, ['stop-start']);
  finishStop();
  const report = await pending;
  assert.equal(report.status, 'complete');
  assert.equal(report.events.at(-1).kind, 'connect');
  assert.equal(report.rawEvents.at(-1).type, 'final-native-change');
  assert.deepEqual(progress, [['stopping'], ['checking'], ['copying', 4, 4]]);
});

await check('Hybrid preserves exact ordered DRC text, duplicates, notes and capture coverage', async () => {
  const recorder = recordingFixture();
  const notes = [{ kind: 'note', at: '2026-09-21T12:00:02.000Z', text: '连接 U1.2 后检查' }];
  const report = await hybridEnvironment(async () => lintRows)(recorder, { notes });
  assert.equal(report.kind, 'hybrid');
  assert.equal(report.lint.status, 'complete');
  assert.deepEqual(plain(report.lint.issues), lintRows);
  assert.equal(report.lint.text, lintRows.map(row => row.rawText).join('\n'));
  assert.deepEqual(plain(report.notes), notes);
  assert.deepEqual(plain(report.rawEvents), recorder.rawEvents);
  assert.deepEqual(plain(report.captureCoverage), recorder.captureCoverage);
  assert.deepEqual(plain(report.lintSnapshots), [plain(report.lint)]);
  assert.equal(report.lint.diag.rerun, true);
});

await check('Hybrid timeline sorts recording and notes by timestamp with stable ties', async () => {
  const recorder = recordingFixture();
  recorder.events.push({ kind: 'rotate', time: '2026-09-21T12:00:03.000Z', seq: 5 });
  const notes = [
    { kind: 'note', at: '2026-09-21T12:00:02.000Z', text: 'between' },
    { kind: 'note', at: '2026-09-21T12:00:03.000Z', text: 'tie' }
  ];
  const report = await hybridEnvironment(async () => lintRows)(recorder, { notes });
  assert.deepEqual(Array.from(report.timeline, item => item.kind),
    ['create', 'note', 'modify', 'rotate', 'note', 'lint-snapshot']);
  assert.equal(report.timeline.at(-1).at, report.lint.finishedAt);
});

await check('Exported Hybrid recording and notes are detached from subsequent mutations', async () => {
  const recorder = recordingFixture();
  const notes = [{ kind: 'note', at: '2026-09-21T12:00:02.000Z', text: 'original' }];
  const report = await hybridEnvironment(async () => lintRows)(recorder, { notes });
  const original = JSON.stringify(report);
  recorder.events[0].raw.object.x = 999;
  recorder.events.push({ kind: 'delete' });
  recorder.rawEvents[0].payload.pin = 'changed';
  recorder.captureCoverage.unsupported.push('changed');
  notes[0].text = 'changed';
  notes.push({ kind: 'note', text: 'later' });
  assert.equal(JSON.stringify(report), original);
});

await check('DRC failure exports the retained recording with an explicit failed result', async () => {
  const recorder = recordingFixture();
  const report = await hybridEnvironment(async () => { throw new Error('No fresh DRC result'); })(recorder);
  assert.equal(report.status, 'check-failed');
  assert.equal(report.lint.status, 'failed');
  assert.match(report.lint.error, /No fresh DRC result/);
  assert.deepEqual(plain(report.events), recorder.events);
  assert.deepEqual(plain(report.rawEvents), recorder.rawEvents);
  assert.deepEqual(plain(report.captureCoverage), recorder.captureCoverage);
});

await check('Stop failure preserves partial recording and prevents a misleading DRC run', async () => {
  const recorder = recordingFixture();
  recorder.stop = async () => { throw new Error('final snapshot unavailable'); };
  const report = await hybridEnvironment(async () => assert.fail('DRC must not run after stop failure'))(recorder);
  assert.equal(report.status, 'recording-incomplete');
  assert.equal(report.lint.status, 'not-run');
  assert.match(report.recordingError, /final snapshot unavailable/);
  assert.deepEqual(plain(report.events), recorder.events);
  assert.deepEqual(plain(report.rawEvents), recorder.rawEvents);
});

// A virtual clock advances only after promise microtasks have run. In particular,
// the check() promise can resolve and cancel its long timeout before DOM updates.
function fakeClock(timerClampMs = 0) {
  let now = 0, sequence = 0, queued = false;
  const timers = new Map();
  const tasks = [];
  function pump() {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      const task = tasks.shift();
      if (task) {
        task();
        if (tasks.length || timers.size) pump();
        return;
      }
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) return;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
      if (tasks.length || timers.size) pump();
    });
  }
  return {
    now: () => now,
    queueTask(callback) { tasks.push(callback); pump(); },
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + Math.max(delay, timerClampMs), callback });
      pump();
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
}

function rows(tag = 'old', count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    text: `2026-09-21 12:00:00\n[信息] : ${tag} ${index}\n  保留原文 <b>&`,
    summary: index === count - 1,
    severity: index === 2 ? 'error' : 'info'
  }));
}

function lintEnvironment({ onCheck, filters = [true, true, true, true, true], initialTop = 0, timerClampMs = 0 } = {}) {
  const clock = fakeClock(timerClampMs);
  const state = { data: rows(), checks: 0, opens: 0, checkedAt: null, replacedAt: null,
    renderedTop: 0, scrollEvents: [], renders: 0, openPorts: 0 };
  class PanelEvent {
    constructor(type, options = {}) { this.type = type; this.bubbles = !!options.bubbles; }
  }
  class PanelMessageChannel {
    constructor() {
      state.openPorts += 2;
      const port = () => ({ closed: false, close() {
        if (!this.closed) { this.closed = true; state.openPorts--; }
      } });
      this.port1 = port(); this.port2 = port();
      this.port2.postMessage = () => clock.queueTask(() => {
        if (!this.port1.closed) this.port1.onmessage({ data: null });
      });
    }
  }
  const doc = { defaultView: { Event: PanelEvent, MessageChannel: PanelMessageChannel } };
  const categories = filters.map(checked => ({ checked, isConnected: true, click() { this.checked = !this.checked; } }));
  categories[0].click = () => categories.forEach(input => { input.checked = true; });
  let top = 0;
  const scroller = {
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
    get scrollHeight() { return state.data.length * 26; },
    clientHeight: 78,
    isConnected: true, ownerDocument: doc,
    dispatchEvent(event) {
      assert.ok(event instanceof PanelEvent, 'Use the panel document event constructor');
      assert.equal(event.type, 'scroll');
      assert.equal(event.bubbles, true);
      const requestedTop = top;
      clock.queueTask(() => { state.renderedTop = requestedTop; state.renders++; });
      state.scrollEvents.push(top);
      return true;
    }
  };
  scroller.scrollTop = initialTop;
  const savedTop = top;
  state.renderedTop = savedTop;
  function makeNode(row) {
    return {
      innerText: row.text, isConnected: true,
      classList: { contains: name => row.severity === name },
      getAttribute: () => String(row.index),
      querySelector(selector) {
        if (selector === '.timestamp') return { textContent: row.text.split('\n')[0] };
        if (selector === '.content') return { innerText: row.text.slice(row.text.indexOf('\n') + 1) };
        return row.summary ? {} : null;
      },
      querySelectorAll: () => []
    };
  }
  state.nodes = state.data.map(makeNode);
  state.replace = data => {
    state.nodes.forEach(node => { node.isConnected = false; });
    state.data = data;
    state.nodes = data.map(makeNode);
    state.replacedAt = clock.now();
  };
  const allParent = {
    get textContent() { return `全部 (${state.data.length})`; },
    querySelector: () => categories[0]
  };
  const root = {
    isConnected: true,
    querySelector(selector) {
      if (selector.includes('log-container-content')) return scroller;
      if (selector.includes('data-test')) return { parentElement: allParent };
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      if (selector.includes('checkbox')) return categories;
      if (!categories.slice(1).some(input => input.checked)) return [];
      // Scroll position and rendered rows remain separate until an event arrives.
      const offset = Math.floor(state.renderedTop / 26);
      return state.nodes.slice(offset, offset + 4);
    }
  };
  doc.querySelector = () => root;
  const context = vm.createContext({
    window: { parent: { document: doc } },
    eda: {
      sys_PanelControl: { openBottomPanel() { state.opens++; } },
      sch_Drc: { check(...args) {
        assert.deepEqual(args, [true, true, false]);
        state.checks++;
        state.checkedAt = clock.now();
        return onCheck ? onCheck(state, clock) : Promise.resolve(false);
      } }
    },
    Date: { now: clock.now },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  vm.runInContext(lintSource, context);
  return { context, state, clock, scroller, categories, savedTop, root };
}
const trigger = env => vm.runInContext('triggerFreshDrc({timeoutMs:400})', env.context);
const runLint = (env, rerun) => env.context.CircuitStudioLinter.runLint({ timeoutMs: 2000, rerun });

await check('Hybrid checks once, copies all 18 occluded virtual rows and restores the rendered viewport', async () => {
  const fresh = rows('new-occluded', 18);
  const env = lintEnvironment({ initialTop: 100, onCheck(state, clock) {
    clock.setTimeout(() => state.replace(fresh), 160);
    return Promise.resolve(false);
  } });
  env.scroller.scrollTop = 0;
  assert.equal(env.state.renderedTop, env.savedTop, 'Changing scrollTop alone must leave stale DOM rows');
  env.scroller.scrollTop = env.savedTop;
  const finalize = hybridEnvironment(options => env.context.CircuitStudioLinter.runLint({ ...options, timeoutMs: 2000 }));
  const report = await finalize(recordingFixture());
  await new Promise(setImmediate);
  assert.equal(report.status, 'complete');
  assert.equal(env.state.checks, 1);
  assert.deepEqual(Array.from(report.lint.issues, row => row.rawText), fresh.map(row => row.text));
  assert.deepEqual(Array.from(report.lint.issues, row => row.index), Array.from({ length: 18 }, (_, i) => i));
  assert.equal(env.scroller.scrollTop, env.savedTop);
  assert.equal(env.state.renderedTop, env.savedTop);
  assert.equal(env.state.scrollEvents.at(-1), env.savedTop);
  assert.equal(env.root.querySelector('p.log[data-log-index]').getAttribute('data-log-index'), String(Math.floor(env.savedTop / 26)));
  assert.equal(env.state.openPorts, 0);
});

await check('background Hybrid checks once and copies asynchronous virtual rows with one-second timer clamping', async () => {
  const fresh = rows('background-new', 18);
  const env = lintEnvironment({ initialTop: 100, timerClampMs: 1000, onCheck(state, clock) {
    clock.queueTask(() => state.replace(fresh));
    return Promise.resolve(false);
  } });
  const finalize = hybridEnvironment(options => env.context.CircuitStudioLinter.runLint({ ...options, timeoutMs: 2000 }));
  const report = await finalize(recordingFixture());
  await new Promise(setImmediate);
  assert.equal(report.status, 'complete');
  assert.equal(env.state.checks, 1);
  assert.deepEqual(Array.from(report.lint.issues, row => row.rawText), fresh.map(row => row.text));
  assert.ok(env.state.renders > 1);
  assert.equal(env.state.renderedTop, env.savedTop);
  assert.equal(env.scroller.scrollTop, env.savedTop);
  assert.equal(env.state.openPorts, 0);
});

await check('A false DRC return waits for new DOM instead of exporting the old completed run', async () => {
  const fresh = rows('new');
  const env = lintEnvironment({ onCheck(state, clock) {
    clock.setTimeout(() => state.replace(fresh), 240);
    return Promise.resolve(false); // false is the expected result when violations exist.
  } });
  const result = await runLint(env, true);
  assert.equal(env.state.checks, 1);
  assert.ok(env.state.replacedAt - env.state.checkedAt >= 240);
  assert.deepEqual(Array.from(result, row => row.rawText), fresh.map(row => row.text));
  assert.equal(env.context.__csLastLintDiag.rerun, true);
});

await check('Same-second DRC with identical text is fresh when its old DOM nodes are replaced', async () => {
  const env = lintEnvironment({ onCheck(state, clock) {
    clock.setTimeout(() => state.replace(rows('old')), 200);
    return Promise.resolve(false);
  } });
  await trigger(env);
  assert.equal(env.state.checks, 1);
  assert.ok(env.clock.now() >= env.state.checkedAt + 200);
  assert.equal(env.state.replacedAt, env.state.checkedAt + 200);
});

await check('Resolved DRC with no fresh DOM rejects instead of silently reusing stale output', async () => {
  const env = lintEnvironment();
  await assert.rejects(trigger(env), /fresh results|Outdated results/);
  assert.equal(env.state.checks, 1);
  assert.ok(env.clock.now() >= env.state.checkedAt + 400);
});

await check('Hybrid fresh rerun waits for a pending passive read and then performs its own check', async () => {
  const fresh = rows('fresh-after-passive');
  const env = lintEnvironment({ onCheck(state, clock) {
    clock.setTimeout(() => state.replace(fresh), 160);
    return Promise.resolve(false);
  } });
  const passive = runLint(env, false);
  const hybrid = runLint(env, true);
  const [oldResult, newResult] = await Promise.all([passive, hybrid]);
  assert.deepEqual(Array.from(oldResult, row => row.rawText), rows('old').map(row => row.text));
  assert.deepEqual(Array.from(newResult, row => row.rawText), fresh.map(row => row.text));
  assert.equal(env.state.checks, 1);
  assert.notStrictEqual(oldResult, newResult);
});

await check('Freshness check exposes filtered old rows before capturing its marker and restores filters', async () => {
  const filters = [false, false, false, false, false];
  const env = lintEnvironment({ filters, onCheck(state, clock) {
    clock.setTimeout(() => state.replace(rows('new-visible')), 160);
    return Promise.resolve(false);
  } });
  await trigger(env);
  assert.ok(env.clock.now() >= env.state.checkedAt + 160);
  assert.deepEqual(env.categories.slice(1).map(input => input.checked), filters.slice(1));
});

await check('Freshness failure also restores the original category filters', async () => {
  const filters = [false, true, false, true, false];
  const env = lintEnvironment({ filters });
  await assert.rejects(trigger(env), /fresh results|Outdated results/);
  assert.deepEqual(env.categories.slice(1).map(input => input.checked), filters.slice(1));
});

console.log(`${checks} Hybrid and fresh-DRC regression cases passed.`);
