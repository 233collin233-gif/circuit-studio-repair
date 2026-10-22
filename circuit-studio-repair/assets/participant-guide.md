# Participant guide

Circuit Studio v1.2.21 captures evidence in EasyEDA; this skill helps an external Agent interpret it, generate a repair prompt, and execute authorized changes through Bridge. The extension calls no model. The Agent supplies intent interpretation, clarification, execution, and verification.

## Prepare

1. Install the `.eext` through EasyEDA's extension manager. Open **Circuit Studio → Circuit Studio Panel** and confirm **v1.2.21**.
2. Copy the complete nested `circuit-studio-repair/` folder to the Agent's skill directory. Codex uses `.codex/skills/` in the user directory. Make sure the Agent can read `SKILL.md` and referenced files; if not yet discovered, ask it to read the installed entry directly.
3. Install Node.js 18+ for local parsing/compilation helpers; these scripts require no npm dependencies or additional API key.
4. For edits, open the matching schematic and connect the supplied EasyEDA Bridge. The Agent needs editor execution tools. Pasting evidence in ordinary chat can support analysis but does not connect EasyEDA.
5. Supply the real export or paste its JSON. Keep the assigned experiment mode and task conditions. For normal local use, the Agent establishes the project/worksheet scope and creates a private history directory on first use, then reuses it for later reports and requests.

## Capture and invoke

**Lint:** run native DRC in EasyEDA first, then **Copy DRC**, then **Export JSON report**. Copying does not rerun the check.

```text
Use $circuit-studio-repair to analyze this Lint input and repair the matching
schematic within my request. Preserve unrelated design choices. Check changed
state, requirements, preservation constraints, and a fresh DRC.
```

**Recorder:** **Start recording**, edit the schematic, optionally **Insert note**, then **Stop and save** and **Export recording**. Notes can be natural language. Recorded changes already happened; they are not a replay list. Selection, zoom, and menu clicks that do not change the design are not recorded as design edits.

```text
Use $circuit-studio-repair to interpret these Recorder notes and before/after
states. My note "connect it back" describes the connection I am trying to
restore. Identify candidate targets from the evidence and current schematic,
apply clear changes, and ask only for the decisive unresolved choice.
```

**Hybrid:** **Start recording**, edit and add notes, then **Stop and check**. Wait for one fresh native DRC before **Export recording + DRC**. The check follows recording finalization, covers only the active worksheet, and leaves the canvas editable. Pause editing while it completes. Failed/incomplete reports can still be analyzed; missing DRC is not zero errors.

```text
Use $circuit-studio-repair to combine this Hybrid recording, notes, and DRC.
Explain supported edit intent with evidence IDs, generate a plan and prompt,
and execute clear changes on the matching schematic. Skip satisfied goals.
Check my requirements, preserved design choices, and a fresh DRC.
```

For analysis only:

```text
Use $circuit-studio-repair to analyze the attached file or pasted JSON.
Generate evidence.json, repair-plan.json, and repair-prompt.md.
Analyze only; do not edit the schematic.
```

Raw JSON or a fenced JSON block can be pasted directly. Local file and stdin inputs share one parser. Preserve the exact received bytes if using the helpers; reformatting changes the input hash. Without local tools, the Agent can analyze supplied text but must state that hashing/compilation was not verified.

For an incomplete copied log or note:

```text
Use $circuit-studio-repair to analyze the following partial text as text mode.
Origin, document identity, completeness, and DRC freshness are unknown.
Explain candidate intent and missing information without treating it as a
full export or making edits from the fragment alone.
```

To continue later:

```text
Use $circuit-studio-repair to execute repair-prompt.md within my requested scope.
Read my scoped project history and prepare a fresh history context. Inspect
the current worksheet, skip goals already satisfied, recheck stale
preconditions, and complete the remaining clear steps with fresh DRC.
```

## Notes and questions

"Insert it here," "restore the former endpoint," "make this smaller," and "keep this" can supply clues. The Agent tests candidate interpretations against recorded and current object/pin/net state. Specifying a designator, pin, or property helps identify the target.

If two endpoints or interpretations remain plausible, or a required property is missing, expect a concise question. An Agent cannot guarantee that it understands every vague expression. It should continue independent clear steps and should not invent a value or connection merely to remove DRC messages.

A missing note does not automatically require a question when your current request and the design state are clear. A note can still omit a consequential detail or conflict with later edits. The Agent saves actual questions and answers separately from the original report and uses them in the next context review; it does not learn new model weights.

To correct an interpretation, state the current goal separately; keep the original export unchanged:

```text
My current request is: [describe the corrected target, change, and constraints].
Keep the original JSON unchanged. Update the plan and prompt, regenerate and
review the change code, inspect a fresh baseline, and use a new repair round.
Keep earlier rounds available for review.
```

The Agent records this correction as the current request, rather than changing what the Recorder originally captured. A saved preference is optional and separate from correcting this task.

## Keep context between requests

The Agent records each report, current request/goal and clarification in local project history before preparing a change. No execution is needed to save a clarification. It reads that history before authoring the next plan and JavaScript; a fresh history reference is required for a write. Prior JavaScript is available if it was archived by a repair round or explicitly supplied. Recorder document snapshots do not recover the original generation script automatically.

From the installed skill directory, the helper workflow is:

```text
node scripts/history.mjs init HISTORY_DIR PROJECT_ID DOCUMENT_UUID
node scripts/history.mjs record HISTORY_DIR INPUT REQUEST.json
node scripts/history.mjs context HISTORY_DIR NEW_CONTEXT.json
```

Run `init` only once for a known scope; the other two commands are repeated for new reports or corrected requests. The Agent reads the context, binds its returned reference to the plan, compiles the prompt and writes reviewed JavaScript. An executed round is then appended automatically. Existing earlier rounds can be imported using `node scripts/history.mjs import-round HISTORY_DIR PRIOR_DIRECTORY/round.json`. See [project history](../references/project-history.md) for the request fields and exact sequence.

To undo an earlier repair, state which change you want reversed. The Agent prepares a comparison between that round's before/after states and the current inspected design, then authors a bounded inverse change. Later unrelated edits must be preserved. This is not automatic whole-document restore; ambiguous or missing historical states require inspection or a question. Preparation alone does not change EDA.

## Results

- `evidence.json`: original received input, parsed evidence, input hash, and source index.
- `repair-plan.json`: targets, desired states, cited evidence, explicit/inferred intent, dispositions, and checks.
- `repair-prompt.md`: reusable English execution instructions; raw evidence keeps its original language.
- For an execution round: a new directory containing received input, plan, prompt, actual JavaScript, inspected evidence, before/after state, DRC, and `execution-result.json`. `round.json` gives the round ID, a previous-round link when used, and archived file hashes.

The response uses seven fields: input/mode/limitations; explicit request; inferred intent with evidence IDs and alternatives; targets/desired changes/preservation; step dispositions; any decisive question; actual actions/checks/unknowns.

Execution outcomes are `not-executed`, `blocked`, `execution-unknown`, `executed-awaiting-review`, or `executed-checks-incomplete`. The Agent must explain what each result means for this round. A generated prompt does not mean the schematic changed; an executed round still needs review against your requirements and preserved conditions. A fresh DRC does not prove electrical or functional correctness.

Normal writes use `round.mjs execute`, which requires an explicit repair request, a ready plan step, a fresh scoped history binding, and an exact match between the inspected baseline and current complete source. A changed source requires a new inspection and review. The helper attempts readback and fresh DRC after a dispatched write even when execution reports an error. A timeout is uncertain and must not trigger an automatic repeat. Avoid concurrent editing while the Agent is writing or verifying.

`round.mjs verify ROUND_JSON` checks archived file integrity only. It does not grade intent interpretation or validate the circuit. Keep real exports, round histories, and participant information outside the public repository.

Optional local preferences require an explicit user confirmation to save a specific preference/correction for the exact project, with its quote and timestamp. They are editable/removable local records, not model training, and cannot override current instructions, live state, or engineering constraints. The repository contains no personal memory; see [../references/preferences.md](../references/preferences.md).

## Examples and checks

`examples/` contains synthetic Lint, Recorder, and failed Hybrid reports with plans/prompts. The document UUID is `SYNTHETIC-EXAMPLE`; all demo steps require inspection. They illustrate data formats and must not be used to modify real schematics.

From the installed skill folder, run `node scripts/self-check.mjs` for parsing, prompt generation, and simulated Bridge checks. It does not modify a live circuit or establish accurate interpretation/electrical correctness. See [../references/export-formats.md](../references/export-formats.md) for capture limits.
