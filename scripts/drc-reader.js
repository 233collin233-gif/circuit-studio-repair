// Copy EasyEDA's existing schematic DRC log, including start/finish messages.
// The caller can request a fresh check; copied text and timestamps stay unchanged.
const DRC_ROOT = '#schDrcPrimaryLog';
const DRC_ROWS = 'p.log[data-log-index]';
const drcDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
let drcPending = null;

function readDrcRow(node) {
  const content = node.querySelector('.content');
  const timestamp = node.querySelector('.timestamp');
  const text = node.innerText;
  const severity = node.classList.contains('fatalError') ? 'fatal'
    : node.classList.contains('error') ? 'error'
    : node.classList.contains('warn') ? 'warning' : 'info';
  const index = Number(node.getAttribute('data-log-index'));
  return {
    ruleId: 'eda-panel-mirror.' + index, index, severity,
    ts: timestamp ? timestamp.textContent : '',
    message: content ? content.innerText : text,
    rawText: text,
    isSummary: !!node.querySelector('[i18n="Finish Design Rule Checking."]'),
    targets: Array.from(node.querySelectorAll('[data-log-find-id]'), n => n.getAttribute('data-log-find-id')),
    raw: { source: 'easyeda-panel-mirror', panel: DRC_ROOT, index }
  };
}

function readDrcTotal(root) {
  const label = root.querySelector('[data-test="All"]');
  const match = label && /[（(]\s*(\d+)\s*[)）]/.exec(label.parentElement.textContent);
  return match ? Number(match[1]) : null;
}

function completeDrcRows(rows, total) {
  return total !== null && rows.length === total
    && rows.every((row, i) => row.index === i)
    && (total === 0 || rows[total - 1].isSummary);
}

async function _scrapeEasyedaDrcPanel({ progress, timeoutMs = 30000, rerun = false } = {}) {
  let doc;
  try { doc = window.parent.document; }
  catch (_) { throw new Error('无法访问 EasyEDA 的 DRC 面板。请在编辑器内打开扩展。'); }
  if (typeof eda !== 'undefined' && eda.sys_PanelControl) {
    await eda.sys_PanelControl.openBottomPanel('schDrcResult');
  }
  const deadline = Date.now() + timeoutMs;
  let root;
  while (Date.now() < deadline) {
    root = doc.querySelector(DRC_ROOT);
    if (root && root.querySelector('[class*="log-container-content_"]')) break;
    await drcDelay(80);
  }
  if (!root) throw new Error('未找到原理图 DRC 日志面板，无法复制结果。');
  // Selectors match EasyEDA's current log component.
  // If its DOM contract changes, fail visibly; adapt after inspecting the new UI.
  const scroller = root.querySelector('[class*="log-container-content_"]');
  if (!scroller) throw new Error('DRC 日志结构已变化，无法确认完整结果。');
  const savedTop = scroller.scrollTop;
  const categories = Array.from(root.querySelectorAll('input[type="checkbox"]'));
  const savedChecked = categories.map(input => input.checked);
  const all = root.querySelector('[data-test="All"]');
  const allInput = all && all.parentElement.querySelector('input[type="checkbox"]');
  let copied = 0, expected = null;
  async function move(top) {
    scroller.scrollTop = top;
    // Wait for the virtual list to render after the scroll event.
    await drcDelay(80);
  }
  try {
    if (allInput && !allInput.checked) { allInput.click(); await drcDelay(80); }
    while (Date.now() < deadline) {
      const rows = new Map();
      expected = readDrcTotal(root);
      let changed = false;
      await move(0);
      while (Date.now() < deadline) {
        if (!root.isConnected || doc.querySelector(DRC_ROOT) !== root) {
          throw new Error('读取期间 DRC 面板已切换，请重新复制。');
        }
        if (readDrcTotal(root) !== expected) { changed = true; break; }
        for (const node of root.querySelectorAll(DRC_ROWS)) {
          const row = readDrcRow(node);
          const previous = rows.get(row.index);
          if (!Number.isInteger(row.index) || row.index < 0
            || (previous && previous.rawText !== row.rawText)) { changed = true; break; }
          rows.set(row.index, row);
        }
        copied = rows.size;
        if (progress) progress(copied, expected || 0, 'drc.copying');
        if (changed) break;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
        await move(scroller.scrollTop + Math.max(1, scroller.clientHeight * 0.7));
      }
      const records = Array.from(rows.values()).sort((a, b) => a.index - b.index);
      if (!changed && completeDrcRows(records, expected) && (!rerun || expected > 0)) {
        // A rerun can reset indexes and reach the same total during the sweep.
        await move(0);
        const first = root.querySelector(DRC_ROWS);
        if (readDrcTotal(root) === expected && root.isConnected
          && (expected === 0 ? !first : first && readDrcRow(first).rawText === records[0].rawText)) {
          return { records, diag: { source: 'panel-mirror', complete: true, copied, expected } };
        }
      }
      // Start a fresh sweep while logs are appending. Never mix separate runs.
      await drcDelay(120);
    }
    throw new Error(`DRC 尚未完整：读取 ${copied}/${expected === null ? '?' : expected} 条，或检查尚未结束。请等待底部 DRC 完成后重试。`);
  } finally {
    for (let i = 1; i < categories.length; i++) {
      if (categories[i].isConnected && categories[i].checked !== savedChecked[i]) categories[i].click();
    }
    if (scroller.isConnected) scroller.scrollTop = savedTop;
  }
}

async function triggerFreshDrc({ timeoutMs = 30000 } = {}) {
  if (typeof eda === 'undefined' || !eda.sch_Drc || typeof eda.sch_Drc.check !== 'function') {
    throw new Error('当前环境无法执行原理图 DRC；录制结果已保留。');
  }
  await eda.sys_PanelControl.openBottomPanel('schDrcResult');
  await drcDelay(80);
  const doc = window.parent.document;
  const filterRoot = doc.querySelector(DRC_ROOT);
  const categories = filterRoot ? Array.from(filterRoot.querySelectorAll('input[type="checkbox"]')) : [];
  const savedChecked = categories.map(input => input.checked);
  const allLabel = filterRoot && filterRoot.querySelector('[data-test="All"]');
  const allInput = allLabel && allLabel.parentElement.querySelector('input[type="checkbox"]');
  if (allInput && !allInput.checked) { allInput.click(); await drcDelay(80); }
  try {
    const oldRoot = doc.querySelector(DRC_ROOT);
    const oldRows = oldRoot ? Array.from(oldRoot.querySelectorAll(DRC_ROWS)) : [];
    const oldText = oldRows.map(node => node.innerText);
    let timer;
    try {
      // false means violations exist. The promise can resolve before React
      // replaces the previous DRC log, so it is not a DOM completion signal.
      await Promise.race([
        eda.sch_Drc.check(true, true, false),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DRC 执行超时，录制结果已保留。')), timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const root = doc.querySelector(DRC_ROOT);
      if (root && root.querySelector(DRC_ROWS) && (root !== oldRoot || !oldRows.length
        || oldRows.some((node, i) => !node.isConnected || node.innerText !== oldText[i]))) return;
      // Do not scroll or toggle filters here: those also replace virtual rows.
      await drcDelay(40);
    }
    throw new Error('DRC 面板没有显示本轮新结果，已阻止导出旧检查结果；请重试。');
  } finally {
    for (let i = 1; i < categories.length; i++) {
      if (categories[i].isConnected && categories[i].checked !== savedChecked[i]) categories[i].click();
    }
  }
}

async function runLint(options = {}) {
  // Lint and Hybrid share one sweep so their scrolling cannot race.
  if (drcPending) {
    if (!options.rerun) return drcPending;
    try { await drcPending; } catch (_) { /* A requested new check can retry. */ }
    return runLint(options);
  }
  globalThis.__csLastLintResult = null;
  globalThis.__csLastLintDiag = { source: 'panel-mirror', complete: false };
  drcPending = (async () => {
    try {
      if (options.rerun) {
        await triggerFreshDrc(options);
      }
      const result = await _scrapeEasyedaDrcPanel(options);
      if (options.rerun && !result.records.length) throw new Error('本次 DRC 没有产生完整日志，请重试检查。');
      result.diag.rerun = !!options.rerun;
      globalThis.__csLastLintDiag = result.diag;
      globalThis.__csLastLintResult = result.records;
      return result.records;
    } catch (error) {
      globalThis.__csLastLintDiag = { source: 'panel-mirror', complete: false, error: error.message };
      throw error;
    } finally { drcPending = null; }
  })();
  return drcPending;
}

const CircuitStudioLinter = { runLint };
if (typeof globalThis !== 'undefined') globalThis.CircuitStudioLinter = CircuitStudioLinter;
