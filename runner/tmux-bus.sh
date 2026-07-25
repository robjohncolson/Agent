#!/usr/bin/env bash
# tmux-bus.sh — Fable's agent bus for tmux session 19 (Codex + Grok panes).
# Runs from Git Bash on Windows; the tmux server lives in WSL, so every tmux
# call goes through `wsl -e tmux`. Scope is LOCKED to session 19.
#
# Usage:
#   tmux-bus.sh discover                 # map + verify who's in which pane
#   tmux-bus.sh peek  <codex|grok> [N]   # last N lines of the pane (default 40)
#   tmux-bus.sh idle  <codex|grok>       # exit 0 if the agent is at its idle prompt
#   tmux-bus.sh ask   <codex|grok> <file># paste a prompt file + Enter (only if idle)
#   tmux-bus.sh await <codex|grok> [sec] # poll until idle (default timeout 1800s)
#   tmux-bus.sh harvest <codex|grok> [N] # capture last N lines (default 400) to the audit log
#
# GUARDRAILS (do not remove):
#   * Only session 19. * Never send to a Claude Code pane (that's Fable itself —
#     footer contains "bypass permissions"). * ask refuses unless the target shows
#     its idle marker (their panes run always-approve; a stray keystroke EXECUTES).
#   * Every ask/harvest is logged verbatim to $LOG_DIR for auditability — the
#     adversarial-review loop is only trustworthy if the raw exchanges are on disk.

set -u
SESSION=19
LOG_DIR="/c/Users/rober/Downloads/Projects/Agent/runner/logs/tmux-bus"
mkdir -p "$LOG_DIR"

T() { wsl -e tmux "$@"; }
ts() { date +%Y%m%d-%H%M%S; }

# ── discovery ────────────────────────────────────────────────────────────────
# Classify each pane in session 19 by its live tail, not by stale titles.
#   codex : "/ps to view" footer or a "›" prompt with a model tag line
#   grok  : boxed "❯" prompt with "always-approve" footer / grok command
#   claude: "bypass permissions" footer  → SELF, never a send target
classify() { # $1 = pane_id → echoes codex|grok|claude|unknown
  local tail; tail=$(T capture-pane -t "$1" -p 2>/dev/null | tail -8)
  case "$tail" in
    *"/ps to view"*|*"gpt-5"*)        echo codex ;;
    *"always-approve"*)               echo grok ;;
    *"bypass permissions"*)           echo claude ;;
    *) case "$(T display-message -pt "$1" '#{pane_current_command}' 2>/dev/null)" in
         grok) echo grok ;; *) echo unknown ;; esac ;;
  esac
}

pane_of() { # $1 = codex|grok → echoes pane_id or fails
  local want="$1" id
  for id in $(T list-panes -t $SESSION -F '#{pane_id}' 2>/dev/null); do
    [ "$(classify "$id")" = "$want" ] && { echo "$id"; return 0; }
  done
  echo "ERROR: no '$want' pane found in session $SESSION" >&2; return 1
}

# ── idle detection ───────────────────────────────────────────────────────────
# Codex idle: a "›" prompt line present and no live "Working/Thinking/esc to interrupt".
# Grok idle: the boxed "❯" prompt with the always-approve footer, no spinner.
is_idle() { # $1 = codex|grok, $2 = pane_id
  # Wider window (25 lines): spinners/status sit ABOVE the composer box and can
  # fall outside a 10-line tail (caused a premature-idle → stale harvest once).
  local tail; tail=$(T capture-pane -t "$2" -p 2>/dev/null | grep -v '^[[:space:]]*$' | tail -25)
  case "$1" in
    codex) echo "$tail" | grep -q "^›" || echo "$tail" | grep -q "› " || return 1
           echo "$tail" | grep -qiE "esc to interrupt|working|thinking" && return 1 ;;
    grok)  echo "$tail" | grep -q "❯" || return 1
           # Busy-Grok's footer says "Esc:cancel" (idle says "Ctrl+x:shortcuts" only) —
           # that's the cleanest discriminator. Spinner glyphs + Status words as backup.
           # Case-SENSITIVE: idle footer contains lowercase "Ctrl+e:expand thinking".
           echo "$tail" | grep -qE "Esc:cancel|Esc to interrupt|Thinking|Working|Waiting for response|⠋|⠙|⠸|⠴|⠦|⠇" && return 1 ;;
  esac
  return 0
}

# ── commands ─────────────────────────────────────────────────────────────────
cmd=${1:-help}; agent=${2:-}; arg3=${3:-}

case "$cmd" in
  discover)
    for id in $(T list-panes -t $SESSION -F '#{pane_id}' 2>/dev/null); do
      who=$(classify "$id")
      state="busy"; { [ "$who" = codex ] || [ "$who" = grok ]; } && is_idle "$who" "$id" && state="idle"
      [ "$who" = claude ] && state="SELF — never a send target"
      printf '%-6s %-8s %s\n' "$id" "$who" "$state"
    done ;;

  peek)
    id=$(pane_of "$agent") || exit 1
    T capture-pane -t "$id" -p | tail -"${arg3:-40}" ;;

  idle)
    id=$(pane_of "$agent") || exit 1
    if is_idle "$agent" "$id"; then echo "$agent ($id): idle"; else echo "$agent ($id): busy"; exit 1; fi ;;

  ask)
    [ -f "$arg3" ] || { echo "ERROR: prompt file '$arg3' not found" >&2; exit 1; }
    id=$(pane_of "$agent") || exit 1
    [ "$(classify "$id")" = claude ] && { echo "REFUSED: target is a Claude pane (self)" >&2; exit 1; }
    is_idle "$agent" "$id" || { echo "REFUSED: $agent is busy — will not inject mid-turn" >&2; exit 1; }
    # audit first, then send. Pipe the prompt via STDIN (`load-buffer -`) — passing a
    # /mnt/... path arg gets mangled by MSYS2 path conversion in Git Bash.
    stamp=$(ts); cp "$arg3" "$LOG_DIR/$stamp-ask-$agent.txt"
    # Submission is the fragile part: TUI composers can swallow Enter during
    # paste-decode, leaving the prompt UNSUBMITTED (looks busy, never runs).
    # Strategy: paste → Enter → VERIFY the turn actually started (composer
    # cleared / working marker). If stuck: Escape to clear, then retype the
    # prompt FLATTENED TO ONE LINE via send-keys -l (immune to paste-decode).
    tailsnip=$(tail -c 50 "$arg3" | tr -d '\n\r' | tail -c 30)
    submitted() { # composer no longer holds our text (placeholder or raw tail visible = stuck)
      local t; t=$(T capture-pane -t "$id" -p 2>/dev/null | tail -12)
      echo "$t" | grep -qE "Pasted Content|\[Pasted:" && return 1
      [ -n "$tailsnip" ] && echo "$t" | grep -qF "$tailsnip" && return 1
      return 0
    }
    T load-buffer -b fablebus - < "$arg3" || { echo "ERROR: load-buffer failed — NOT sending" >&2; exit 1; }
    T paste-buffer -b fablebus -t "$id" -d && sleep 2 && T send-keys -t "$id" Enter && sleep 3
    if ! submitted; then T send-keys -t "$id" Enter; sleep 3; fi
    if ! submitted; then
      echo "paste-submit stuck — clearing composer and retyping single-line" >&2
      T send-keys -t "$id" Escape; sleep 1; T send-keys -t "$id" Escape; sleep 1
      oneline=$(tr '\n' ' ' < "$arg3" | sed 's/  */ /g')
      T send-keys -t "$id" -l "$oneline"; sleep 1.5; T send-keys -t "$id" Enter; sleep 3
    fi
    # Final confirmation: within ~20s the agent should leave idle (turn running).
    started=no
    for i in 1 2 3 4; do
      sleep 5
      if ! is_idle "$agent" "$id"; then started=yes; break; fi
    done
    echo "sent → $agent ($id); turn-started: $started; audit: $stamp-ask-$agent.txt"
    [ "$started" = no ] && echo "WARN: $agent still looks idle — prompt may not have submitted; peek to confirm" >&2 ;;

  await)
    id=$(pane_of "$agent") || exit 1
    limit=${arg3:-1800}; waited=0
    # settle: give the agent a moment to leave idle after a fresh ask
    sleep 10; waited=10
    until is_idle "$agent" "$id"; do
      sleep 15; waited=$((waited+15))
      [ "$waited" -ge "$limit" ] && { echo "TIMEOUT after ${waited}s ($agent still busy)"; exit 2; }
    done
    echo "$agent idle after ~${waited}s" ;;

  harvest)
    id=$(pane_of "$agent") || exit 1
    n=${arg3:-400}; out="$LOG_DIR/$(ts)-harvest-$agent.txt"
    T capture-pane -t "$id" -p -S -"$n" > "$out"
    echo "$out" ;;

  *)
    grep '^#   tmux-bus' "$0" | sed 's/^# //' ;;
esac
