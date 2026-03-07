# Agent: Blooket Probe Script Cleanup

Delete the one-off probe scripts that were used for DOM discovery and are no longer needed.

## Hard Constraints

- DELETE ONLY the files listed below. Do not modify any other files.
- Do NOT delete `find-blooket-set.mjs` or `delete-blooket-sets.mjs` — those are permanent utilities.

## Files to Delete

1. `scripts/probe-blooket.mjs`
2. `scripts/probe-blooket-create.mjs`
3. `scripts/probe-blooket-csv.mjs`
4. `scripts/probe-blooket-csv2.mjs`
5. `scripts/probe-blooket-api.mjs`
6. `scripts/probe-blooket-delete.mjs`
7. `scripts/probe-blooket-mysets.mjs`

That is 7 files total. Verify each exists before deleting. If a file doesn't exist, skip it silently.
