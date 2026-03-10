# Step 2 Selective Resume — Implementation Prompts

## Wave 1 (parallel)

### Prompt T1: Registry Self-Heal Logic

```
You are editing C:/Users/ColsonR/Agent/scripts/lesson-prep.mjs

TASK: Add registry self-heal logic for Step 2 sub-tasks.

LOCATION: In the main orchestration function, right after the three canResume() calls
for Step 2 (around line 1735-1738), BEFORE the allStep2Done check.

CURRENT CODE (around lines 1735-1738):
  const step2WorksheetResume = canResume(existingEntry, "worksheet", worksheetPath, opts.force, opts.forceSteps);
  const step2BlooketResume = canResume(existingEntry, "blooketCsv", blooketCsvPath, opts.force, opts.forceSteps);
  const step2DrillsResume = canResume(existingEntry, "drills", null, opts.force, opts.forceSteps);
  const allStep2Done = step2WorksheetResume.skip && step2BlooketResume.skip && step2DrillsResume.skip;

WHAT TO ADD: Between the canResume() calls and the allStep2Done line, insert a
self-heal block. For worksheet and blooketCsv (the two sub-tasks that have artifact
files), check: if canResume returned skip:false BUT the artifact file exists on disk
AND is non-empty, then:
1. Update the registry: call updateStatus(unit, lesson, stepKey, "done")
2. Override the resume variable to { skip: true, reason: "healed (artifact exists)" }
3. Log: console.log(`  Registry heal: ${stepKey} artifact found on disk, marking done`);

The artifact paths are already available as worksheetPath and blooketCsvPath.
Use existsSync and statSync to check file existence and non-zero size.

DO NOT modify any other part of the file. Only add the heal block between the
canResume calls and the allStep2Done assignment.

Import statSync from 'node:fs' if not already imported (check the top of the file).
```

### Prompt T2: Selective Skip in step2_contentGeneration

```
You are editing C:/Users/ColsonR/Agent/scripts/lesson-prep.mjs

TASK: Add selective per-task skipping to step2_contentGeneration().

LOCATION: The function starting around line 958:
  async function step2_contentGeneration(unit, lesson, opts = {})

CHANGES:

1. Add a 4th parameter: skipTasks (a Set of task keys to skip)
   New signature: async function step2_contentGeneration(unit, lesson, opts = {}, skipTasks = new Set())

2. The function builds a `tasks` array around lines 1044-1063 with entries like:
   { key: "worksheet", label: "Worksheet + Grading", workingDir, prompt }
   { key: "blooket", label: "Blooket CSV", workingDir, prompt }
   { key: "drills", label: "Drills Cartridge" | "Cartridge + Animations", workingDir, prompt }

   Right after the tasks array is built, add logic to:
   a) Separate tasks into `tasksToRun` and `tasksToSkip` based on skipTasks set
   b) For each skipped task, log: console.log(`  ${task.label}: skipped (already done)`)
   c) Create synthetic results for skipped tasks: { label: task.label, success: true, skipped: true }

3. Only launch Codex for tasksToRun (the Promise.all block around lines 1065-1086).
   After Promise.all resolves, merge the real results with the synthetic skip results.
   Return the merged array in the original task order.

4. If tasksToRun is empty (all skipped), skip the Promise.all entirely and return
   only synthetic results.

5. Also skip building prompts for tasks that will be skipped. The prompt building
   happens around lines 966-1037. Wrap each prompt-building section in a check:
   - Only build worksheetPrompt if !skipTasks.has("worksheet")
   - Only build blooketPrompt if !skipTasks.has("blooket")
   - Only build drillsPrompt if !skipTasks.has("drills")

DO NOT modify the canResume logic, the orchestration block, or any other function.
Only modify step2_contentGeneration and its internal helpers.
```

### Prompt T4: Fix Stale Registry Entry

```
You are editing C:/Users/ColsonR/Agent/state/lesson-registry.json

TASK: Fix the stale blooketCsv status for lesson 6.4.

Find the "6.4" entry and change:
  "blooketCsv": "pending"
to:
  "blooketCsv": "done"

The file exists on disk (u6_l4_blooket.csv, 11KB), so this is a valid status correction.

DO NOT change any other entry in the file.
```

## Wave 2 (after Wave 1 completes)

### Prompt T3: Orchestration Block Refactor

```
You are editing C:/Users/ColsonR/Agent/scripts/lesson-prep.mjs

TASK: Refactor the Step 2 orchestration block to use selective skipping.

PREREQUISITES: T1 (heal logic) and T2 (selective skip) are already applied.

LOCATION: The orchestration block around lines 1735-1771.

CURRENT CODE (to be replaced):
  const step2WorksheetResume = canResume(existingEntry, "worksheet", worksheetPath, opts.force, opts.forceSteps);
  const step2BlooketResume = canResume(existingEntry, "blooketCsv", blooketCsvPath, opts.force, opts.forceSteps);
  const step2DrillsResume = canResume(existingEntry, "drills", null, opts.force, opts.forceSteps);
  [T1 heal block will be here after Wave 1]
  const allStep2Done = step2WorksheetResume.skip && step2BlooketResume.skip && step2DrillsResume.skip;

  if (allStep2Done) {
    console.log("=== Step 2: Content generation — all tasks already done (registry) ===");
    console.log(`  Worksheet: ${step2WorksheetResume.reason}`);
    console.log(`  Blooket CSV: ${step2BlooketResume.reason}`);
    console.log(`  Drills: ${step2DrillsResume.reason}\n`);
    results.codexResults = [
      { label: "Worksheet + Grading", success: true, skipped: true },
      { label: "Blooket CSV", success: true, skipped: true },
      { label: "Drills Cartridge", success: true, skipped: true },
    ];
  } else {
    const step2Start = Date.now();
    pipelineEvents.stepStarted('lesson-prep', 'content-gen');
    results.codexResults = await step2_contentGeneration(unit, lesson, opts);
    ...status updates...
  }

REPLACE WITH:
  Keep the canResume() calls and T1 heal block as-is.

  Build a skipTasks set from the resume results:
    const step2SkipTasks = new Set();
    if (step2WorksheetResume.skip) step2SkipTasks.add("worksheet");
    if (step2BlooketResume.skip) step2SkipTasks.add("blooket");
    if (step2DrillsResume.skip) step2SkipTasks.add("drills");

  Then:
  - If step2SkipTasks.size === 3 (all done): keep the existing fast path
    (log all skipped, return synthetic results, no Codex call).
  - Otherwise: log which tasks will be skipped and which will run, then call:
    results.codexResults = await step2_contentGeneration(unit, lesson, opts, step2SkipTasks);
    Update registry status for each result as before.
  - Log the skip reasons for any skipped tasks in the Step 2 banner.

Keep the existing event tracking (pipelineEvents.stepStarted/Completed/Failed)
and registry status updates (updateStatus calls) intact.

DO NOT modify step2_contentGeneration itself or canResume — those are already done.
```
