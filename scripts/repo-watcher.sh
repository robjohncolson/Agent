#!/bin/bash
# Repo watcher — polls a git repo for file changes and new commits
# Usage: repo-watcher.sh <repo-path> <repo-slug> <interval-seconds>

REPO_PATH="$1"
SLUG="$2"
INTERVAL="${3:-15}"
LOG_DIR="C:/Users/ColsonR/Agent/state/watch"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${SLUG}.log"

# Snapshot baseline
cd "$REPO_PATH" || exit 1
LAST_HASH=$(git rev-parse HEAD 2>/dev/null)
LAST_STATUS=$(git status --porcelain 2>/dev/null)

echo "[$(date '+%H:%M:%S')] Watcher started for $SLUG ($REPO_PATH)" > "$LOG_FILE"
echo "[$(date '+%H:%M:%S')] HEAD: $LAST_HASH" >> "$LOG_FILE"

while true; do
  sleep "$INTERVAL"
  cd "$REPO_PATH" || continue

  # Check for new commits
  CURRENT_HASH=$(git rev-parse HEAD 2>/dev/null)
  if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
    NEW_COMMITS=$(git log --oneline "${LAST_HASH}..${CURRENT_HASH}" 2>/dev/null)
    echo "[$(date '+%H:%M:%S')] NEW COMMITS:" >> "$LOG_FILE"
    echo "$NEW_COMMITS" >> "$LOG_FILE"
    # Show changed files in latest commit
    git diff --stat "${LAST_HASH}..${CURRENT_HASH}" >> "$LOG_FILE" 2>/dev/null
    echo "---" >> "$LOG_FILE"
    LAST_HASH="$CURRENT_HASH"
  fi

  # Check for working tree changes
  CURRENT_STATUS=$(git status --porcelain 2>/dev/null)
  if [ "$CURRENT_STATUS" != "$LAST_STATUS" ]; then
    echo "[$(date '+%H:%M:%S')] WORKING TREE CHANGED:" >> "$LOG_FILE"
    # Show what's new/different
    echo "$CURRENT_STATUS" >> "$LOG_FILE"
    echo "---" >> "$LOG_FILE"
    LAST_STATUS="$CURRENT_STATUS"
  fi
done
