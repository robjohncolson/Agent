# R4: Clean up aistudio-ingest.mjs

## File to modify
`C:/Users/ColsonR/Agent/scripts/aistudio-ingest.mjs`

## Read the file first
Read the entire file to understand its current state. It has been through ~10 iterations of debugging and has accumulated dead code.

## Changes needed

1. **Remove the `--launch` fallback code**: The `launchNewBrowser()` function and all references to `--launch` flag. CDP is the only approach that works on this school machine. Simplifies the script significantly.

2. **Remove old response selectors that never matched**: Clean up the responseSelectors array. The selectors that actually work (discovered via live DOM probing):
   - Chat turns: `ms-chat-turn, .chat-turn`
   - Model response: the turn with the most content (longest `.innerText`)
   - Run/Stop button: `button.ctrl-enter-submits` (class-based, not text-based)

3. **Remove the `extractResponseText()` fallback function** if it's no longer called (the response is now extracted directly in `waitForResponse`).

4. **Update the file header comment** to accurately describe the CDP-only approach.

5. **Update `--help` text** to remove `--launch` and add a note about Gemini 3.1 Pro being the default (zero API quota, web UI only).

6. **Remove the `render_65.py` and `upload_65.py` temp files** from lrsl-driller if they still exist:
   - Delete `C:/Users/ColsonR/lrsl-driller/render_65.py`
   - Delete `C:/Users/ColsonR/lrsl-driller/upload_65.py`

7. **Remove the `probe-aistudio.mjs` debug script** — or keep it but mark it as a debug tool in the header comment. Your choice — it's useful for future DOM changes.

## Do NOT
- Change any of the working logic (CDP connection, clipboard paste, Ctrl+Enter submit, response detection)
- Change the Drive picker flow (manual pick is correct and working)
- Add new features

After changes, verify with `node --check`.
