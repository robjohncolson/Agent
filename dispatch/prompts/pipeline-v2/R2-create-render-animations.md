# R2: Create render-animations.mjs

## Create file
`C:/Users/ColsonR/Agent/scripts/render-animations.mjs`

## Purpose
Render Manim animation .py files for a given unit+lesson. Handles ffmpeg PATH setup automatically.

## Usage
```bash
node scripts/render-animations.mjs --unit 6 --lesson 5
# Optional: --quality l (low/480p, default), --quality m (medium/720p), --quality h (high/1080p)
```

## Implementation

1. **Find animation files**: Glob for `C:/Users/ColsonR/lrsl-driller/animations/apstat_{U}{L}_*.py`
   - For unit 6 lesson 5, pattern is `apstat_65_*.py`

2. **Set up environment**: Add ffmpeg to PATH
   - ffmpeg is at `C:/Users/ColsonR/ffmpeg/bin`
   - Python is at `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`

3. **Render each file**: Run `python -m manim render -q{quality} {filepath}`
   - Working directory must be `C:/Users/ColsonR/lrsl-driller`
   - Pass the environment with ffmpeg PATH included
   - Quality flag: `-ql` (low/480p15), `-qm` (medium/720p30), `-qh` (high/1080p60)

4. **Report results**: For each rendered file, print:
   ```
   ✓ TestStatisticZScore.mp4 (301 KB) → media/videos/apstat_65_test_statistic/480p15/TestStatisticZScore.mp4
   ```

5. **Error handling**: If a render fails, print the error but continue with remaining files.

## Args
- `--unit` / `-u` — unit number (required)
- `--lesson` / `-l` — lesson number (required)
- `--quality` / `-q` — render quality: `l` (default), `m`, `h`
- `--repo` — lrsl-driller repo path (default: `C:/Users/ColsonR/lrsl-driller`)

## Constants
```js
const PYTHON = "C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe";
const FFMPEG_DIR = "C:/Users/ColsonR/ffmpeg/bin";
const DEFAULT_REPO = "C:/Users/ColsonR/lrsl-driller";
```

## Do NOT
- Add npm dependencies
- Modify any other files
- Run uploads (that's a separate script)

After creating, verify with `node --check`.
