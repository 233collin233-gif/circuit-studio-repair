// Run: node check.mjs (no test framework or new dependencies).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./linter.js', import.meta.url), 'utf8');
const makeRows = (n = 10, tag = 'A') => Array.from({ length: n }, (_, index) => ({
  index, text: `2026-09-21 15:42:08\n[信息] : ${tag} ${index}\n  保留空格 <b>&`,
  summary: index === n - 1, severity: ['info', 'warn', 'error', 'fatalError'][index % 4]
}));

function environment(initial, change = () => {}, { missing = -1, filters = [true, true, true, true, true], timerClampMs = 0 } = {}) {
  const state = { data: initial, now: 0, opens: 0, checks: 0, renderedTop: 0, scrollEvents: [],
    renders: 0, timerCalls: 0, openPorts: 0 };
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
      this.port2.postMessage = () => setImmediate(() => {
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
    clientHeight: 78, isConnected: true, ownerDocument: doc,
    dispatchEvent(event) {
      assert.ok(event instanceof PanelEvent, 'Use the panel document event constructor');
      assert.equal(event.type, 'scroll');
      assert.equal(event.bubbles, true);
      const requestedTop = top;
      // React commits in a later task; dispatching the event is not a render.
      setImmediate(() => {
        state.renderedTop = requestedTop;
        state.renders++;
        change(state);
      });
      state.scrollEvents.push(top);
      return true;
    }
  };
  scroller.scrollTop = 100;
  const savedTop = top;
  state.renderedTop = savedTop;
  function node(row) {
    return {
      innerText: row.text,
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
      // An occluded editor does not deliver the native scroll event immediately.
      const offset = Math.floor(state.renderedTop / 26);
      return state.data.slice(offset, offset + 4).filter(row => row.index !== missing).map(node);
    }
  };
  doc.querySelector = () => root;
  const context = vm.createContext({
    window: { parent: { document: doc } },
    eda: { sys_PanelControl: { openBottomPanel() { state.opens++; } },
      sch_Drc: { check() { state.checks++; assert.fail('Must not rerun DRC'); } } },
    Date: { now: () => state.now },
    setTimeout(callback, ms) {
      state.timerCalls++;
      setImmediate(() => { state.now += Math.max(ms, timerClampMs); change(state); callback(); });
    }
  });
  vm.runInContext(source, context);
  return { context, state, scroller, savedTop, categories, root };
}

const run = env => vm.runInContext('runLint({timeoutMs:2000})', env.context);
const text = rows => Array.from(rows, row => row.rawText);
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };

await check('10 virtual rows, all severities, raw text and scroll restoration', async () => {
  const env = environment(makeRows());
  const rows = await run(env);
  assert.deepEqual(text(rows), env.state.data.map(row => row.text));
  assert.deepEqual(Array.from(rows.slice(0, 4), row => row.severity), ['info', 'warning', 'error', 'fatal']);
  assert.equal(env.scroller.scrollTop, env.savedTop);
});
await check('occluded virtual list copies all 18 rows without checking and restores the rendered viewport', async () => {
  const data = makeRows(18);
  const env = environment(data);
  const visible = () => env.root.querySelectorAll('p.log[data-log-index]').map(node => node.getAttribute('data-log-index'));
  const originalVisible = visible();
  env.scroller.scrollTop = 0;
  assert.equal(env.state.renderedTop, env.savedTop, 'Changing scrollTop alone must leave stale DOM rows');
  assert.deepEqual(visible(), originalVisible);
  env.scroller.scrollTop = env.savedTop;
  const result = await run(env);
  await new Promise(setImmediate); // The restoration event also commits asynchronously.
  assert.deepEqual(text(result), data.map(row => row.text));
  assert.deepEqual(Array.from(result, row => row.index), Array.from({ length: 18 }, (_, i) => i));
  assert.equal(env.state.checks, 0);
  assert.equal(env.scroller.scrollTop, env.savedTop);
  assert.equal(env.state.renderedTop, env.savedTop);
  assert.deepEqual(visible(), originalVisible);
  assert.equal(env.state.scrollEvents.at(-1), env.savedTop);
  assert.equal(env.state.openPorts, 0);
});
await check('completed background log copies through asynchronous tasks despite a 60-second timer clamp', async () => {
  const data = makeRows(18);
  const env = environment(data, undefined, { timerClampMs: 60000 });
  assert.deepEqual(text(await run(env)), data.map(row => row.text));
  await new Promise(setImmediate);
  assert.equal(env.state.checks, 0);
  assert.equal(env.state.timerCalls, 0, 'A completed virtual-list sweep must not wait on throttled timers');
  assert.ok(env.state.renders > 1);
  assert.equal(env.state.renderedTop, env.savedTop);
  assert.equal(env.state.openPorts, 0);
});
await check('identical text at separate indexes is retained twice', async () => {
  const data = makeRows(); data[2].text = data[1].text;
  const rows = await run(environment(data));
  assert.equal(rows.length, 10); assert.equal(rows[1].rawText, rows[2].rawText);
});
await check('late appends after old 600 ms stability threshold are fully copied', async () => {
  const data = makeRows();
  const env = environment(data.slice(0, 6), state => { if (state.now >= 900) state.data = data; });
  assert.deepEqual(text(await run(env)), data.map(row => row.text));
  assert.ok(env.state.now >= 900);
});
await check('header can announce 10 before all DOM rows render', async () => {
  const data = makeRows();
  const incomplete = data.map((r, i) => i === 8 ? { ...r, index: 7 } : r);
  const env = environment(incomplete, state => { if (state.renders >= 8) state.data = data; });
  assert.deepEqual(text(await run(env)), data.map(row => row.text));
  assert.ok(env.state.renders >= 8);
});
await check('same-count rerun during scroll does not mix old and new rows', async () => {
  const fresh = makeRows(10, 'B');
  const env = environment(makeRows(), state => { if (state.renders >= 3) state.data = fresh; });
  assert.deepEqual(text(await run(env)), fresh.map(row => row.text));
});
await check('missing row times out visibly and never reports success', async () => {
  const env = environment(makeRows(), undefined, { missing: 2 });
  await assert.rejects(run(env), /DRC capture is incomplete/);
  await new Promise(setImmediate);
  assert.equal(env.context.__csLastLintDiag.complete, false);
  assert.equal(env.context.__csLastLintResult, null);
  assert.equal(env.scroller.scrollTop, env.savedTop);
  assert.equal(env.state.renderedTop, env.savedTop);
});
await check('unfinished check with no completion row is not called complete', async () => {
  const data = makeRows(); data[9].summary = false;
  await assert.rejects(run(environment(data)), /DRC capture is incomplete/);
});
await check('original category filters are restored', async () => {
  const filters = [false, true, false, true, false];
  const env = environment(makeRows(), undefined, { filters });
  await run(env);
  assert.deepEqual(env.categories.slice(1).map(input => input.checked), filters.slice(1));
});
await check('empty panel is an empty snapshot', async () => {
  assert.equal((await run(environment([]))).length, 0);
});
await check('concurrent Lint/Hybrid calls share one scroll pass', async () => {
  const env = environment(makeRows());
  const [a, b] = await Promise.all([run(env), run(env)]);
  assert.deepEqual(text(a), text(b)); assert.equal(env.state.opens, 1);
});

// Verify the actual iframe bundle and main bundle, not just the reference copy.
const html = readFileSync(new URL('./build/iframe/index.html', import.meta.url), 'utf8');
assert.ok(html.includes(source));
assert.equal(html.split('async function runLint(').length - 1, 1);
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const main = readFileSync(new URL('./build/dist/index.js', import.meta.url), 'utf8');
new vm.Script(main);
assert.ok(main.includes('#schDrcPrimaryLog'));
assert.ok(!html.includes('body.innerText'));
assert.ok(!html.includes('lines.push(\n\t\t\t`<div class="lint-log-row lint-log-summary">'));
console.log(`${checks} regression cases + bundle checks passed.`);
