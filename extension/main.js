// main.js — Circuit Studio entry point
// Architecture: lint + recorder bundled by esbuild into a single IIFE
//   (globalName = 'edaEsbuildExportName'). The iframe panel runs in a separate
//   webview with direct access to window.eda; the main thread acts as a loader,
//   menu registrar, and IPC bridge (sys_MessageBus primary, postMessage fallback).
//
// Console error reporting: all caught errors are written to console with a stable
// prefix [CS-ERR] and a category tag ([main], [lint], [recorder], [bridge], [iframe])
// so users can grep their DevTools log and get a structured failure trail.

import './linter.js';
import './hybrid.js';
import { Recorder } from './recorder.js';

// linter.js attaches its public API to globalThis under the
// `CircuitStudioLinter` namespace so this entry file doesn't need a named
// export binding (which would force the linter source to have a top-level
// `export`, breaking its use as a side-effect-only module loaded by the
// EasyEDA extension runtime).
const runLint = (typeof globalThis !== 'undefined' && globalThis.CircuitStudioLinter && globalThis.CircuitStudioLinter.runLint) || (() => Promise.resolve([]));

// (noise swallower removed in 1.2.1 — v1.1.3 recorder logic prevents the
// wire bug from triggering, so we don't need to demote console errors)

// ============== Error reporter ==============
function reportError(category, err, extra = {}) {
	const payload = {
		ts: new Date().toISOString(),
		category,
		message: String(err && err.message ? err.message : err),
		stack: err && err.stack ? String(err.stack).split('\n').slice(0, 5).join('\n  ') : null,
		...extra
	};
	try {
		console.error('[CS-ERR]', JSON.stringify(payload));
	} catch (_) {
		console.error('[CS-ERR]', category, payload.message);
	}
}

// ============== iframe bridge (sys_MessageBus + postMessage dual-channel) ==============
const IFRAME_FILE = '/iframe/index.html';
const IFRAME_W = 760;
const IFRAME_H = 640;
const IFRAME_ID = 'circuit-studio-iframe';

let _messageBus = null;
function getMessageBus() {
	if (_messageBus) return _messageBus;
	try {
		if (eda && eda.sys_MessageBus && typeof eda.sys_MessageBus.createPrivateMessageBus === 'function') {
			_messageBus = eda.sys_MessageBus.createPrivateMessageBus();
		}
	} catch (e) {
		reportError('bridge', e, { phase: 'create_bus' });
	}
	return _messageBus;
}

function sendToIframe(msg) {
	const bus = getMessageBus();
	if (bus && typeof bus.publish === 'function') {
		try { bus.publish(IFRAME_ID, JSON.stringify(msg)); return; } catch (e) {
			reportError('bridge', e, { phase: 'bus_publish', type: msg && msg.type });
		}
	}
	try {
		const target = (typeof document !== 'undefined' && document.querySelector) ? document : null;
		if (!target) { reportError('bridge', new Error('no document'), { phase: 'postmessage_no_doc' }); return; }
		const iframes = target.querySelectorAll('iframe');
		const last = iframes[iframes.length - 1];
		if (last && last.contentWindow) {
			last.contentWindow.postMessage(JSON.stringify(msg), '*');
		} else {
			reportError('bridge', new Error('no iframe contentWindow'), { phase: 'postmessage_no_iframe' });
		}
	} catch (e) {
		reportError('bridge', e, { phase: 'postmessage', type: msg && msg.type });
	}
}

// ============== State ==============
let currentMode = 'lint';
let recorder = null;
let hybridReport = null;
let recordingTransition = false;
let userNotes = [];

// ============== Lint ==============
async function runLintAndSend() {
	if (typeof eda === 'undefined') {
		sendToIframe({ type: 'cs.lint.error', payload: { message: 'eda global not loaded' } });
		reportError('lint', new Error('eda global not loaded'));
		return;
	}
	try {
		eda.sys_Message.showToastMessage('Circuit Studio: linting...');
		const issues = await runLint({
			progress: (i, total, ruleId) => {
				sendToIframe({ type: 'cs.lint.progress', payload: { i, total, ruleId } });
			}
		});
		const diag = (typeof globalThis !== 'undefined' && globalThis.__csLastLintDiag) || null;
		const rawConsole = (typeof globalThis !== 'undefined' && globalThis.__csLastDrcConsole) || null;
		try { globalThis.__csLastLintDiag = diag; } catch (_) {}
		sendToIframe({ type: 'cs.lint.result', payload: { issues, diag, rawConsole } });
		eda.sys_Message.showToastMessage(`Circuit Studio: lint done, ${issues.length} issue(s)`);
	} catch (err) {
		const msg = String(err && err.message ? err.message : err);
		sendToIframe({ type: 'cs.lint.error', payload: { message: msg } });
		reportError('lint', err, { phase: 'run_lint' });
		try { eda.sys_Dialog.showInformationMessage(msg, 'Circuit Studio · Lint Error'); } catch (_) {}
	}
}

// ============== Recorder ==============
function ensureRecorder() {
	if (recorder) return recorder;
	recorder = new Recorder((event) => {
		sendToIframe({ type: 'cs.recorder.event', payload: { event } });
	});
	return recorder;
}

async function startRecording() {
	if (recordingTransition) return;
	recordingTransition = true;
	try {
		await ensureRecorder().start();
		hybridReport = null;
		userNotes = [];
		eda.sys_Message.showToastMessage('Circuit Studio: recording started');
		sendToIframe({ type: 'cs.recorder.started' });
	} catch (e) {
		const msg = String(e && e.message ? e.message : e);
		sendToIframe({ type: 'cs.recorder.error', payload: { message: msg } });
		reportError('recorder', e, { phase: 'start' });
	} finally { recordingTransition = false; }
}

async function stopRecording() {
	if (!recorder || recordingTransition) return;
	recordingTransition = true;
	try {
		if (currentMode === 'hybrid') {
			hybridReport = await globalThis.CircuitStudioHybrid.finalizeHybrid(recorder, { notes: userNotes });
			sendToIframe({ type: 'cs.hybrid.result', payload: hybridReport });
		} else await recorder.stop();
		eda.sys_Message.showToastMessage('Circuit Studio: recording stopped');
		sendToIframe({ type: 'cs.recorder.stopped' });
	} catch (e) {
		reportError('recorder', e, { phase: 'stop' });
	} finally { recordingTransition = false; }
}

async function clearRecording() {
	if (!recorder || recordingTransition || recorder.recording) return;
	recordingTransition = true;
	try {
		await recorder.clear();
		hybridReport = null;
		userNotes = [];
		sendToIframe({ type: 'cs.recorder.cleared' });
	} catch (e) {
		reportError('recorder', e, { phase: 'clear' });
	} finally { recordingTransition = false; }
}

// ============== Export report ==============
async function exportReport(target) {
	const edaObj = (typeof eda !== 'undefined') ? eda : null;
	let report;
	try {
		if (target === 'lint') {
			const issues = await runLint();
			report = { kind: 'lint', at: new Date().toISOString(), issues };
		} else if (target === 'recorder' && recorder) {
			await recorder.flush();
			report = { ...recorder.buildLog(), notes: userNotes };
		} else if (target === 'hybrid' && hybridReport && !recordingTransition) {
			report = hybridReport;
		} else {
			try { edaObj && edaObj.sys_Dialog.showInformationMessage('Please run lint or record first', 'Circuit Studio'); } catch (_) {}
			return;
		}
	} catch (e) {
		reportError('main', e, { phase: 'build_report', target });
		return;
	}

	const json = JSON.stringify(report, null, 2);
	const filename = `circuit-studio-${target}-${Date.now()}.json`;

	try {
		if (edaObj && edaObj.sys_FileSystem && typeof edaObj.sys_FileSystem.saveFileToFileSystem === 'function') {
			const ok = await edaObj.sys_FileSystem.saveFileToFileSystem(`/lceda-extensions-circuit-studio/${filename}`, json);
			if (ok) {
				try { edaObj.sys_Message.showToastMessage(`Saved: ${filename}`); } catch (_) {}
				return;
			}
		}
	} catch (e) {
		reportError('main', e, { phase: 'sys_filesystem_save' });
	}

	try {
		if (edaObj && edaObj.sys_Dialog && typeof edaObj.sys_Dialog.showInformationMessage === 'function') {
			const preview = json.length > 1500 ? json.slice(0, 1500) + '\n...(truncated)' : json;
			edaObj.sys_Dialog.showInformationMessage(
				'Could not save file directly (EDA filesystem API unavailable).\nFull JSON below (please copy manually):\n\n' + preview,
				'Circuit Studio · Export Failed'
			);
			return;
		}
	} catch (e) {
		reportError('main', e, { phase: 'sys_dialog_fallback' });
	}

	console.log('[CS-EXPORT]', filename, json);
}

// ============== iframe message handling ==============
function setupIframeBridge() {
	const target = (typeof globalThis !== 'undefined' ? globalThis : null)
		|| (typeof window !== 'undefined' ? window : null);
	if (!target || typeof target.addEventListener !== 'function') {
		reportError('bridge', new Error('no message target'), { phase: 'setup_bridge' });
		return;
	}
	target.addEventListener('message', async (ev) => {
		let msg;
		try { msg = JSON.parse(ev.data); } catch { return; }
		if (!msg || !msg.type) return;

		try {
			switch (msg.type) {
				case 'cs.ready':
					sendToIframe({ type: 'cs.mode', payload: { mode: currentMode } });
					break;

				// Lint
				case 'cs.lint.run':
					runLintAndSend();
					break;
				case 'cs.lint.jumpTo': {
					const { primitiveId } = msg.payload || {};
					if (!primitiveId) break;
					try {
						if (typeof eda !== 'undefined') {
							try {
								await eda.sch_SelectControl.selectPrimitives([primitiveId]);
							} catch (_) {
								try { eda.sys_Message.showToastMessage(`Primitive ${primitiveId} located`); } catch (__) {}
							}
						}
					} catch (e) {
						reportError('main', e, { phase: 'jumpTo', primitiveId });
					}
					break;
				}

				// Recorder
				case 'cs.recorder.start':	await startRecording(); break;
				case 'cs.recorder.stop':	await stopRecording(); break;
				case 'cs.recorder.clear':	await clearRecording(); break;

				// Notes
				case 'cs.addNote': {
					const note = msg.payload && msg.payload.note;
					if (typeof note === 'string' && note.trim()) {
						const entry = {
							seq: (recorder ? recorder.events.length + 1 : userNotes.length + 1),
							at: new Date().toISOString(),
							kind: 'note',
							text: note.trim()
						};
						userNotes.push(entry);
						sendToIframe({ type: 'cs.recorder.noteAdded', payload: { entry } });
						// Hybrid DRC runs once after recording stops.
					}
					break;
				}

				case 'cs.export':
					await exportReport(msg.payload && msg.payload.target);
					break;

				case 'cs.ping':
					sendToIframe({ type: 'cs.pong', id: msg.id });
					break;
			}
		} catch (e) {
			reportError('main', e, { phase: 'handle_message', type: msg.type });
		}
	});
}

// ============== Open iframe panel ==============
async function openIframe(file, w, h, successMsg) {
	const ts = Date.now();
	console.log('[CS]', ts, 'openIFrame START file=' + file, w + 'x' + h);
	try {
		if (typeof eda === 'undefined') throw new Error('eda global not available');
		if (!eda.sys_IFrame) throw new Error('eda.sys_IFrame not available');
		if (typeof eda.sys_IFrame.openIFrame !== 'function') throw new Error('eda.sys_IFrame.openIFrame is not a function');
		if (typeof eda.sys_IFrame.closeIFrame === 'function') {
			try { await eda.sys_IFrame.closeIFrame(IFRAME_ID); } catch (_) {}
		}
		const ok = await eda.sys_IFrame.openIFrame(file, w, h, IFRAME_ID, {
			title: 'Circuit Studio',
			minimizeButton: true,
			maximizeButton: true
		});
		console.log('[CS]', ts, 'openIFrame END ok=', ok);
		if (ok) {
			try { eda.sys_Message.showToastMessage(successMsg || 'Circuit Studio opened'); } catch (_) {}
		} else {
			reportError('main', new Error('openIFrame returned false'), { file });
			try {
				eda.sys_Dialog.showInformationMessage(
					'openIFrame returned false.\nPossible causes: HTML not bundled into extension / old version still installed / filename case mismatch.\n\n' + file,
					'Circuit Studio · Open Failed'
				);
			} catch (_) {}
		}
	} catch (err) {
		reportError('main', err, { phase: 'open_iframe', file });
		const m = String(err && err.message ? err.message : err);
		try { eda.sys_Message.showToastMessage('Open failed: ' + m); } catch (_) {}
		try { eda.sys_Dialog.showInformationMessage('Failed to open panel: ' + m, 'Circuit Studio'); } catch (_) {}
	}
}

// ============== Menu entry points ==============
function openLint() {
	currentMode = 'lint';
	openIframe(IFRAME_FILE, IFRAME_W, IFRAME_H, '🛡 Lint Check opened');
}

function about() {
	try {
		// Older EasyEDA dialogs ignore resize hints; scrolling keeps the text accessible.
		const aboutHtml = `
<div style="font-family: -apple-system, 'Segoe UI', Arial, sans-serif; min-width: 360px; max-width: 720px; resize: both; overflow: auto; padding: 4px 8px;">
  <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px;">Circuit Studio v1.2.21</div>
  <div style="line-height: 1.6;">
    <div>🛡 <b>Lint</b> — Copies the existing DRC log with original text and timestamps, verifying every row.</div>
    <div>🎬 <b>Recorder</b> — Records schematic edits, wire geometry, properties and coordinate contacts, with before/after evidence and native events.</div>
    <div>⚡ <b>Hybrid</b> — Stops and drains recording, runs a fresh DRC, then exports operations and the complete DRC log together.</div>
  </div>
  <div style="margin-top: 8px; color: #888; font-size: 12px;">
    All reports export as JSON. No AI / no network. Works offline.<br>
    v1.2.21: English interface across Lint, Recorder, and Hybrid. Original DRC output and notes retain their source language.
  </div>
</div>`.trim();
		eda.sys_Dialog.showInformationMessage(aboutHtml, 'Circuit Studio');
	} catch (e) {
		reportError('main', e, { phase: 'about' });
	}
}

// ============== EDA activation callback ==============
function activate(status, arg) {
	console.log('[CS]', 'activate() called, status=', status);
	try { setupIframeBridge(); } catch (e) { reportError('main', e, { phase: 'activate' }); }
	try {
	const banner = [
		'============================================',
		'[Circuit Studio] VERSION 1.2.21',
		'[Circuit Studio] Built: 2026-09-28',
		'[Circuit Studio] Schematic source changes + native editing events + complete DRC logs',
		'[Circuit Studio] 3 modes: lint / recorder / hybrid',
		'[Circuit Studio] Passive DRC mirror: indexed virtual-list sweep; verifies total and completion row',
		'[Circuit Studio] If you see this, the NEW version is loaded.',
		'[Circuit Studio] Errors are reported as [CS-ERR] {json} on console.error',
		'============================================'
	].join('\n');
	console.log(banner);
	try { eda.sys_Message.showToastMessage('Circuit Studio v1.2.21 loaded'); } catch (_) {}
	} catch (e) {
		reportError('main', e, { phase: 'activate_toast' });
	}

	try {
		if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
			globalThis.addEventListener('error', (ev) => {
				reportError('global', ev.error || new Error(ev.message || 'unknown'), {
					source: ev.filename, line: ev.lineno, col: ev.colno
				});
			});
			globalThis.addEventListener('unhandledrejection', (ev) => {
				reportError('global', ev.reason || new Error('unhandled rejection'));
			});
		}
	} catch (_) {}
}

// ============== ES Module exports ==============
export {
	activate,
	openLint,
	about
};
