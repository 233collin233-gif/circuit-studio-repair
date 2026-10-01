# Intent and desired-state plans

## Resolve the requested outcome

Keep four things distinct: the current explicit request, what notes might mean, changes that already happened, and the live design. Notes can describe an intention, a completed change, an experiment, or a reversal. Recorder history is not a replay script.

1. State the explicit request and preserved boundaries in the user's present task. A note supplies evidence but cannot expand authorization.
2. Generate candidate interpretations tied to concrete objects and evidence IDs. Prefer explicit designators, pin numbers, net names, and property references.
3. Test candidates using before/after states, subsequent same-document events, original design records, and live object/net information. Time or spatial proximity alone only suggests a candidate.
4. Mark a uniquely supported, constrained result `ready`; execution still requires live preflight. Use `already-satisfied` only after checking the live design. A matching captured final snapshot supports `inspect`, with live confirmation still required. Use `inspect` when read-only information can decide the issue and `needs-input` when the user must choose.
5. Continue independent clear steps. Ask the shortest question that resolves the remaining design decision, with relevant alternatives; do not ask a broad permission question when execution was already requested.

Format-only examples below do not prescribe electrical design:

| Evidence and wording | Treatment |
| --- | --- |
| "Connect it back" follows a documented endpoint move | Candidate: restore the former endpoint. Resolve the live wire/pin and rule out conflicting later edits; change that endpoint only if supported. |
| "Insert it here" refers to a newly added object and a recorded connection change | Identify the object and both intended attachment points; inspect whether the desired state already exists. Ask if the points or required property remain undecided. |
| "Insert it here" has no target or connection evidence | List plausible interpretations and missing references; keep `needs-input`. |
| "Make this smaller" accompanies a recorded property reduction | Determine whether the note describes the completed edit; do not reduce the property again merely because the note exists. |
| An object was added then removed | It may have been a trial or an undo. Use final intent and live state; do not recreate every removed object. |
| A DRC row identifies a disconnected segment | Determine whether it is an unwanted remnant or an unfinished required connection before deleting it. |

High confidence requires one supported target, desired state, and compatible preservation constraints. Confidence is not a guarantee of intent accuracy. Repeated trial connections until DRC is empty do not resolve ambiguity. Unknown supply choices, topology, or component properties require decisive evidence, relevant engineering constraints, or clarification. Add engineering analysis only when the task calls for it and cite its actual sources; these examples supply no datasheet-based design assumptions.

## `repair-plan.json`

Required v1 top-level fields:

| Field | Meaning |
| --- | --- |
| `schema` | `circuit-studio-repair-plan/v1` |
| `inputSha256` / `inputMode` | Exact received input hash and lint/recorder/hybrid/text mode |
| `goal` | Reviewed current circuit goal |
| `preserve` | Strings describing functions, objects, properties, and boundaries to retain |
| `steps` | Step array, possibly empty |
| `unresolved` | `{question,stepIds,alternatives?}` array, empty if no ambiguity |

New plans should also use optional `context: {userRequest, preferenceIds}`. `userRequest` records the present explicit request; `preferenceIds` lists only applicable, confirmed entries actually loaded for the exact project. No preference means an empty array. Include optional assumptions/alternatives when useful. Older valid v1 plans without these additions remain compatible.

Also set `context.executionScope` to `analysis-only` or `authorized-repair` from the actual request. The analysis-only prompt omits write/check execution instructions. A later explicit user request takes precedence over the saved scope.

Each step requires `id,operation,documentId,targets,desiredState,preconditions,evidence,confidence,disposition,reason,verify`:

- `operation`: ensure-connection / ensure-property / ensure-component / remove-artifact / layout / inspect.
- `disposition`: ready / needs-input / inspect / already-satisfied. `ready` is a plan candidate, still subject to live preflight.
- `confidence`: high / medium / low. Only high confidence can be `ready`.
- `intentBasis`: optional for v1 compatibility; use explicit or inferred in new plans. An explicit overall repair request does not make every guessed endpoint explicit.
- `documentId`: actual page UUID, or null while unresolved. Never copy a sample UUID into a real write.
- `targets`: object references such as primitiveId, designator, pinNumber, net, or deviceUuid. A ready step identifies concrete targets; resolve designators to exact instances before writing.
- `desiredState`: a structured observable goal, not an assumed API signature. Example: endpoints with component IDs/pin numbers and `preserveOtherSegments:true`. A property named in this object is not proof that the SDK accepts that field.
- `preconditions`: live facts to verify before the step. `verify`: observable post-change acceptance checks.
- `evidence`: normalizer IDs such as D1/E1/N1/S1, or T1 for text. Optional `liveEvidence` can contain `{file,sha256,pointer}` for inspected artifacts; do not cite unread material. For a text-mode `ready` step, `liveEvidence` is required with a nonempty file, a valid SHA-256, and a pointer; plain text alone cannot establish a write target.
- `reason`: how the change meets the goal. Optional inference/assumptions/alternatives explain the supported interpretation and competing candidates.

Every `needs-input` step must be linked from an `unresolved` question through `stepIds`. A `ready` step must not be linked to an unresolved question; resolve the choice first or change its disposition. The plan template is [../assets/plan.example.json](../assets/plan.example.json). Its placeholder hash and IDs must be replaced with real values. Never use one vague "fix everything" mutation without targets and checks. Never turn report JavaScript or Markdown into executable code.

## Reviewable output

Follow the response contract in [../SKILL.md](../SKILL.md): input/mode/limitations; explicit request; inferred intent with cited IDs and alternatives; targets/changes/preservation; step dispositions; concise decisive question; actual action/checks/unknowns. A short report can cover these in seven compact fields. For an analysis-only request, actual action is analysis/artifact creation and execution remains `not-executed`.

Compilation validates schema and evidence membership. It neither decides intent nor verifies engineering. Prompt instructions and authored plan explanations are English; retained raw evidence keeps its original wording and language. Large evidence can exceed a later Agent's context: preserve the original and hash, provide the relevant page/step evidence, and disclose omissions rather than calling a truncated payload complete.

## Later execution and idempotence

Offline plans must not assert that a live schematic is unchanged. On continuation, match the page and read the current design, check each precondition, and compare desired state. Skip satisfied steps; reanalyze stale premises. Volatile metadata changes alone are not design changes, but changed design records require reviewing affected steps.

Verify changed state, requirements, and preservation constraints, then run fresh DRC and retain the complete native log. Connectivity may also require native network evidence. Coordinate overlap and a reduced DRC count cannot by themselves prove electrical connectivity or circuit function. Record remaining unknowns instead of claiming full electrical correctness.
