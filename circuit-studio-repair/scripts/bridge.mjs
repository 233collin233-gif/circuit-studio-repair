import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function request(base, route, body, timeout = 3000) {
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout)
  });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error(result.error || 'Bridge HTTP ' + response.status);
  return result;
}
export async function discover(port) {
  const ports = port ? [Number(port)] : Array.from({ length: 10 }, (_, i) => 49620 + i);
  if (ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error('Invalid port');
  const found = (await Promise.all(ports.map(async p => {
    const base = 'http://127.0.0.1:' + p;
    try { const health = await request(base, '/health', undefined, 800); return health.service === 'easyeda-bridge' ? { base, health } : null; }
    catch (_) { return null; }
  }))).filter(Boolean);
  if (found.length !== 1) throw new Error(found.length ? 'Multiple bridges: select --port explicitly.' : 'No EasyEDA Bridge found on loopback.');
  return found[0];
}
export async function selectWindow(base, requested) {
  const result = await request(base, '/eda-windows');
  const windows = (result.windows || []).filter(w => w.connected);
  if (requested) {
    if (!windows.some(w => w.windowId === requested)) throw new Error('Requested EDA window is not connected.');
    return requested;
  }
  if (windows.length !== 1) throw new Error('Use --window with the verified target window; connected IDs: ' + windows.map(w => w.windowId).join(', '));
  return windows[0].windowId;
}
async function main() {
  const [command, ...args] = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--port', '--window', '--out', '--code', '--document'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid option');
    opts[args[i].slice(2)] = args[i + 1];
  }
  if (!['health', 'inspect', 'drc', 'run'].includes(command)) throw new Error('Commands: health | inspect | drc --document UUID | run --document UUID --code FILE; options --port --window --out');
  const { base, health } = await discover(opts.port);
  if (command === 'health') { console.log(JSON.stringify({ base, health, ...await request(base, '/eda-windows') }, null, 2)); return; }
  if (!opts.out) throw new Error('--out is required to preserve full output.');
  if (opts.code && path.resolve(opts.code) === path.resolve(opts.out)) throw new Error('Output would overwrite code input.');
  const windowId = await selectWindow(base, opts.window);
  const expected = opts.document ? JSON.stringify(opts.document) : null;
  const guard = `const info = await eda.dmt_SelectControl.getCurrentDocumentInfo();\n` +
    (expected ? `if (!info || info.uuid !== ${expected}) throw new Error('Target document changed; nothing executed.');\n` : '');
  let code;
  if (command === 'inspect') {
    code = guard + `const source = await eda.sys_FileManager.getDocumentSource();\nconst after = await eda.dmt_SelectControl.getCurrentDocumentInfo();\nif (!info?.uuid || after?.uuid !== info.uuid || typeof source !== 'string') throw new Error('Document changed or source unavailable.');\nreturn { document: info, source };`;
  } else {
    if (!expected) throw new Error('--document UUID is required before DRC or mutation.');
    if (command === 'run') {
      if (!opts.code) throw new Error('--code must name a reviewed JavaScript body, never an export note.');
      code = guard + '\nreturn await (async () => {\n' + await fs.readFile(opts.code, 'utf8') + '\n})();';
    } else {
      const reader = await fs.readFile(new URL('./drc-reader.js', import.meta.url), 'utf8');
      code = guard + '\nreturn await (async () => {\n' + reader + `\nconst issues = await CircuitStudioLinter.runLint({rerun:true});\nconst after = await eda.dmt_SelectControl.getCurrentDocumentInfo();\nif (after?.uuid !== ${expected}) throw new Error('Document changed during DRC');\nreturn {kind:'lint', at:new Date().toISOString(), document:info, issues, text:issues.map(r=>r.rawText).join('\\n'),diag:globalThis.__csLastLintDiag};\n})();`;
    }
  }
  // A timeout has an uncertain outcome. The CLI deliberately never retries writes.
  const response = await request(base, '/execute', { code, windowId }, 120000);
  await fs.writeFile(opts.out, JSON.stringify(response.result, null, 2));
  console.log(JSON.stringify({ windowId, file: path.resolve(opts.out), success: true }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
