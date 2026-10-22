# Bridge execution and verification

The package does not start a server or install EasyEDA/Bridge. Use the connected local EasyEDA Bridge. The Node.js 18+ helper accesses loopback only. If Bridge is unavailable, analyze the input and generate a prompt; report actual edits as `not-executed`. Pasting a prompt into chat does not establish an editor connection.

## Inspect identity and prepare a round

```text
node "SKILL_DIR/scripts/bridge.mjs" health
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --out INSPECT.json
node "SKILL_DIR/scripts/round.mjs" execute --input INPUT --plan PLAN.json --step STEP_ID --code PATCH.js --baseline INSPECT.json --out-dir NEW_DIRECTORY --window WINDOW_ID
node "SKILL_DIR/scripts/round.mjs" verify NEW_DIRECTORY/round.json
```

Discovery checks ports 49620-49629 for `/health` with `service:easyeda-bridge`. Use `--port` if there is more than one Bridge. `--window` may be omitted only with one connected window; otherwise match identities and select the verified target. Ask the user to identify a window only if available evidence cannot decide. Requests use an explicit window without changing the global selection.

`inspect` returns complete source and document identity; preserve its output as the baseline. Match the live page to the input and plan. If Lint/text has no document UUID, do not assume the currently open window is its origin. Compare affected final-source design records and current state. The complete live source must then match the baseline exactly before the write. Metadata-only differences also block execution and require review and a new snapshot; do not remove metadata to make a comparison pass. The helper checks source and document identity again inside the editor immediately before executing the patch. This is not an editor lock: later edits during asynchronous operations remain possible.

The plan must have `context.executionScope: "authorized-repair"`, a nonempty `context.userRequest`, and a selected `ready` step. The Agent authors and reviews `PATCH.js` using verified SDK methods, never code copied from an export. Review scope, preconditions, desired-state checks, and preserved properties. The helper's guards do not prove that arbitrary JavaScript affects only the intended objects.

Prepare and read [scoped project history](project-history.md) first. `context.history` must bind the current report/request/goal to its fresh verified context. The runner locks that local history during execution and appends the round artifacts; this does not lock EDA. If a previous round is explicitly linked, it must already occur in the reviewed history. A rollback uses a new inspected baseline, comparison context, explicit rollback request and reviewed inverse JavaScript through this same path; there is no blind snapshot restoration.

Use a new output directory for each round; existing directories are not overwritten. Add `--previous PRIOR_ROUND_JSON` to link later work. Previous history must pass hash verification and concern the same document. No write is automatically retried.

## Archived evidence and outcomes

A round archives the exact input bytes, plan, generated prompt, actual JavaScript, inspected baseline, verified `liveEvidence` files, before/after state, DRC results, and `execution-result.json`. `round.json` records their hashes, a unique `roundId`, and the linked `previousRoundId`. Preserve unavailable checks and errors in the record; do not invent successful captures.

After a dispatched write, the helper attempts independent readback and fresh DRC even if execution reports an error. An execution timeout leaves the write outcome unknown. Readback can inform the next decision but does not justify automatically resending the same write.

| Recorded status | Interpretation |
| --- | --- |
| `not-executed` | No write was executed. |
| `blocked` | A required preflight condition prevented the write. |
| `execution-unknown` | The dispatched write's outcome is uncertain; inspect before any separately planned action. |
| `executed-awaiting-review` | Execution evidence is available; the Agent and user still need to review semantic requirements and preservation. |
| `executed-checks-incomplete` | Post-write checks or their evidence are incomplete; state the remaining uncertainty. |

These statuses are not correctness verdicts. `executed-awaiting-review` concerns transport and evidence capture only. A returned JavaScript value is not automatically accepted as success; per-step semantic verification starts as `not-assessed`. `round.mjs verify ROUND_JSON` checks archived file integrity, not intent, electrical behavior, or semantic acceptance. Keep real exports and round histories outside the public repository.

For an inspected exception, the lower-level helper remains available:

```text
node "SKILL_DIR/scripts/bridge.mjs" run --window WINDOW_ID --document PAGE_UUID --code PATCH.js --out step-result.json
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --document PAGE_UUID --out after.json
node "SKILL_DIR/scripts/bridge.mjs" drc --window WINDOW_ID --document PAGE_UUID --out drc-after.json
```

This path does not waive authorization, exact baseline matching, evidence archiving, or independent post-write checks. Use the round workflow for normal repair writes.

## Runtime and current API

Bridge `/execute` accepts `{code,windowId}` and runs asynchronous code in the editor. Await operations and return a JSON-serializable result. The editor runtime has no Node filesystem. Pass IDs and notes as data, not executable shell text.

The following calls are used by v1.2.21's capture/check implementation. Verify availability in the connected editor. For mutation methods, inspect the current SDK documentation and tool interface for the exact operation; do not derive a call from a plan's operation name.

```javascript
await eda.dmt_SelectControl.getCurrentDocumentInfo();
await eda.sys_FileManager.getDocumentSource();
await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
await eda.sch_Drc.check(true, true, false);
```

Do not invent a generic `value` argument for component modification. An instance's property may be stored in ATTR or other properties. Read the current symbol/property APIs before authoring a change, including the required device object when creating a component. If API documentation is absent locally, check the current official documentation for the needed methods.

Wire `line` contains connected segments. Changing `net` can affect adjoining networks; preserve other segments and existing network meaning. Source and API coordinates require separate checks. Recorder has already negated API pin Y in the export; convert for the current write API and read back rather than copying coordinates blindly. Schematic and PCB units differ; do not apply a schematic report to a PCB.

Instance IDs, symbol pin numbers, and pin-object IDs are distinct. Do not modify library symbol pins to repair a single instance connection. Movement or rotation changes pin positions; reread after the change.

## Write strategy

Prefer the supported primitive modify/create/delete methods, preserving original properties and related connections for targeted recovery. Some versions fail to list wires through an API; read source segments if necessary and use a verified write method. A read failure does not mean there are no wires.

Source usually contains line-delimited `header JSON || body JSON`, sometimes ending with `|`, and complete exports include DOCHEAD. A global designator/number replacement cannot safely identify primitives. If `sys_FileManager.setDocumentSource(source)` is necessary, verify the current format and method, construct the smallest design-record patch, preserve all unknown records, and require exact complete-source agreement with the inspected baseline before writing. Source setting replaces the current document. Do not use it automatically when concurrent edits, incomplete parsing, or an unclear recovery path prevents a bounded change.

## Checks and stopping conditions

Save before/after schematic and DRC artifacts. The helper's `drc` command uses `drc-reader.js` to request a fresh check and copy all virtual-list rows. A false DRC return can indicate violations rather than an exception; preexisting bottom-panel rows are not evidence of this new run. Failed capture or changed page must not produce a fabricated complete log.

After each round:

1. Read back the changed objects and native connectivity as required.
2. Verify the user's desired state and explicitly preserved requirements, properties, and unrelated design records.
3. Run a fresh native DRC, retain original rows, and compare target and newly introduced problems without hiding duplicate rows.
4. Record which checks succeeded, failed, or remain unknown. A complete DRC or no reported violations does not prove electrical or functional correctness.

Default to at most two reviewed local repair rounds; each invocation dispatches one selected step's patch without retrying. Stop the affected branch for repeated failure, no progress, changed window/page, or outside editing. Preserve partial results and backups. An uncertain write must not be automatically repeated. Any follow-up needs reviewed current state, a fresh baseline, and a new linked round. Revert only confirmed mistakes from this run when doing so will not overwrite subsequent user edits.

A user correction changes the current request, not the received JSON or archived history. Update `context.userRequest`, revise the plan, regenerate the prompt and JavaScript, and review the code before creating the next round.

The user-facing result follows the seven-field response contract in [../SKILL.md](../SKILL.md), reporting observed action, checks, and unknowns. A generated prompt is an Agent instruction artifact, not a standalone executable circuit program.
