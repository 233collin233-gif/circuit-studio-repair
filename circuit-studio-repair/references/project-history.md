# Project history and rollback preparation

Use one local history directory for an exact project and worksheet UUID. Keep it outside the public repository and installed skill. It stores design content; it is not a model-training dataset. Do not invent a worksheet UUID when a Lint report or pasted text lacks identity: establish the mapping through read-only inspection first. Unscoped chat-only analysis remains possible, with persistence and provenance stated as unavailable.

A Recorder/Hybrid report may include several worksheets. Preserve its complete raw content; the history scope identifies the worksheet being refined, not a filter that removes other captured pages. Check each event's ownership before using it as evidence for that worksheet.

## Record before interpreting or writing

Create the scope once. For every received Lint, Recorder, Hybrid or text input, preserve the file (or exact received paste saved to a file) and record it before preparing the plan. Also record a new request entry when the user answers a clarification or corrects the goal, even if no edit follows. The same report bytes may accompany multiple requests; earlier entries remain unchanged.

```text
node "SKILL_DIR/scripts/history.mjs" init HISTORY_DIR PROJECT_ID DOCUMENT_UUID
node "SKILL_DIR/scripts/history.mjs" record HISTORY_DIR INPUT REQUEST.json
node "SKILL_DIR/scripts/history.mjs" context HISTORY_DIR NEW_CONTEXT.json
```

`REQUEST.json` contains the actual current request, its stated goal, and any real clarification exchanges:

```json
{
  "userRequest": "Connect wire-1 to pin 2 and keep the other connections unchanged.",
  "goal": "Connect wire-1 to pin 2.",
  "clarifications": []
}
```

Each clarification is `{id,question,answer,at}` with the actual wording and known timestamp. Do not fabricate an exchange or its time. `clarifications: []` is correct when the request is already clear. Optional `supersedes: ["earlier-report-entry-id"]` records an explicit correction to an earlier request; it does not resolve semantic conflicts automatically. A later request does not imply that every earlier preservation condition was cancelled.

The helper timestamps receipt with `recordedAt`, preserves exact input bytes and SHA-256, and keeps the original export timestamps unchanged. These times describe capture/receipt, not proof of user intent or execution. An optional final argument imports a supplied initial generation script:

```text
node "SKILL_DIR/scripts/history.mjs" record HISTORY_DIR INPUT REQUEST.json INITIAL.js
```

The script is labelled user-supplied historical code whose execution is not established by the import. No helper searches arbitrary chats or recovers missing generation code. Recorder's `initialSource` and `finalSource` are schematic document snapshots, not the generating JavaScript.

Existing archived repair rounds can be imported explicitly, including rounds saved before project history was added:

```text
node "SKILL_DIR/scripts/history.mjs" import-round HISTORY_DIR PRIOR_DIRECTORY/round.json
```

The importer verifies the manifest and retained artifact hashes, requires the same worksheet and any recorded project scope, and copies the saved artifacts into history. It preserves the round's actual status, including failed or unknown execution; importing is not evidence of a successful repair. If a completed write was saved locally but appending history failed, inspect that saved round and use this command to recover its history entry. Do not run the mutation again to repair a local archive failure.

## Read context, then author the plan and code

Read `NEW_CONTEXT.json` before deciding targets or authoring JavaScript. It contains the current request/goal, earlier reports and clarification answers, actual archived repair JavaScript, snapshots and check results. Original compiled prompts and binary live evidence remain available through verified file links, avoiding recursively embedding earlier history. For large histories, inspect the relevant referenced files; do not silently truncate and claim full review.

Copy the `context` command's returned reference into `repair-plan.json` as `context.history`: `{file,sha256,headId,projectId,documentId}`. A relative `file` resolves from the plan directory. `context.userRequest` and `goal` must match the latest recorded request; `inputSha256` must match its report. Compilation includes verified history when this reference is present. Existing analysis-only plans remain readable without it; round execution requires it.

The round helper rejects missing, stale, altered or wrongly scoped context before contacting the editor. It holds a local history lock during the round and appends the completed/failed round with its original input, prompt, JavaScript, inspected baseline, before/after state, checks and status. Existing live-state guards still apply. A lock does not prevent manual EDA editing. If a process crashes and leaves `.history-lock`, inspect the saved round and current design before manually removing that empty lock directory; never use lock removal as permission to repeat an uncertain write.

These checks establish file consistency and a declared context binding. They cannot prove that an Agent read, understood or correctly interpreted the history. SHA-256 detects changed retained bytes; these local, unsigned records do not establish authorship or resist wholesale hostile rewriting. No continuous learning or accuracy improvement is claimed.

## Prepare a bounded rollback

Rollback is a new authorised refinement, not a one-click restore. First record the user's explicit rollback request, inspect the current worksheet and prepare the history context. Then obtain a comparison for a retained round:

```text
node "SKILL_DIR/scripts/bridge.mjs" inspect --window WINDOW_ID --out CURRENT_BASELINE.json
node "SKILL_DIR/scripts/history.mjs" rollback HISTORY_DIR ROUND_ID CURRENT_BASELINE.json ROLLBACK_CONTEXT.json
```

The result contains historical before/after states, original repair JavaScript and the inspected current state. It reports whether the current source still matches the historical after-state. A mismatch is a reason to examine later edits, not permission to overwrite them. Missing historical before/after data prevents this preparation; inspect manually and do not fabricate a restore operation.

The Agent identifies the specific change to reverse, checks affected objects and later edits, then writes a minimal inverse plan and reviewed JavaScript. Keep ambiguities `inspect` or `needs-input`. Do not replay the old script or replace the complete current document with a stored snapshot. Add `context.rollback: {file,sha256,authorized:true,request}` using the returned context hash and the actual explicit rollback request, which must be part of `context.userRequest`. This records existing authorisation; do not ask again if the user already requested this rollback.

Use normal `round.mjs execute` with the new plan, inverse JavaScript, inspected baseline and reviewed history. It verifies the rollback context and fresh baseline, then performs the same readback and DRC attempts. Preparation does not execute or certify an inverse; the Agent/user must still check the desired state and preservation of later unrelated edits.
