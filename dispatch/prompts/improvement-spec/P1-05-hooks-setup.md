# Agent: Hooks Setup

## Phase
P1-foundation | No dependencies | Working dir: `C:/Users/ColsonR`

## Objective
Add PostToolUse lint hooks to `~/.claude/settings.json` alongside the existing GitNexus PreToolUse hooks.

## Read First
1. `C:/Users/ColsonR/.claude/settings.json` — MUST preserve existing hooks

## Existing Configuration (DO NOT REMOVE)
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Grep|Glob|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/ColsonR/.claude/hooks/gitnexus/gitnexus-hook.cjs\"",
            "timeout": 8000,
            "statusMessage": "Enriching with GitNexus graph context..."
          }
        ]
      }
    ]
  },
  "autoUpdatesChannel": "latest",
  "skipDangerousModePermissionPrompt": true,
  "effortLevel": "high"
}
```

## Add: PostToolUse Hooks

Add a `PostToolUse` key alongside the existing `PreToolUse`:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "bash -c 'FILE=\"$CLAUDE_FILE\"; if [[ \"$FILE\" == *.py ]]; then python -m py_compile \"$FILE\" 2>&1 | head -5; fi'",
        "timeout": 5000,
        "statusMessage": "Checking Python syntax..."
      },
      {
        "type": "command",
        "command": "bash -c 'FILE=\"$CLAUDE_FILE\"; if [[ \"$FILE\" == *.js || \"$FILE\" == *.mjs ]]; then node --check \"$FILE\" 2>&1 | head -5; fi'",
        "timeout": 5000,
        "statusMessage": "Checking JS syntax..."
      }
    ]
  }
]
```

## Constraints
- PRESERVE all existing keys (PreToolUse, autoUpdatesChannel, etc.)
- Do NOT duplicate the GitNexus hook
- Both PostToolUse hooks fire on the same matcher (Edit|Write) — they run sequentially
- Each hook only fires for its file extension (Python or JS)
- 5s timeout prevents blocking on large files

## Verification
```bash
node -e "
  const s = JSON.parse(require('fs').readFileSync('C:/Users/ColsonR/.claude/settings.json'));
  console.log('PreToolUse:', s.hooks.PreToolUse ? 'OK' : 'MISSING');
  console.log('PostToolUse:', s.hooks.PostToolUse ? 'OK' : 'MISSING');
  console.log('GitNexus hook preserved:', JSON.stringify(s.hooks.PreToolUse).includes('gitnexus') ? 'OK' : 'MISSING');
"
```
