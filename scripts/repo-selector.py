#!/usr/bin/env python3
"""
TUI Repo Selector — multi-select menu for project repos.

Arrow keys to navigate, Space to toggle, Enter to confirm.
Outputs selected repo absolute paths (one per line) to stdout.
"""

import curses
import os
import sys

PROJECTS_ROOT = r"C:\Users\rober\Downloads\Projects"

# Top-level dirs to also scan one level deeper for git repos
NESTED_DIRS = ["school", "not-school"]


def discover_repos(root):
    """Find all git repos under root (top-level + nested dirs), with metadata."""
    repos = []
    seen_paths = set()

    def scan_dir(directory, group=None):
        """Scan a directory for git repos and append them."""
        if not os.path.isdir(directory):
            return
        for entry in sorted(os.listdir(directory)):
            full = os.path.join(directory, entry)
            if not os.path.isdir(full):
                continue
            if full in seen_paths:
                continue
            git_dir = os.path.join(full, ".git")
            if not os.path.isdir(git_dir):
                continue
            seen_paths.add(full)
            has_gitnexus = os.path.isdir(os.path.join(full, ".gitnexus"))
            has_continuation = os.path.isfile(os.path.join(full, "CONTINUATION_PROMPT.md"))
            has_claude_md = os.path.isfile(os.path.join(full, "CLAUDE.md"))
            display = f"{group}/{entry}" if group else entry
            repos.append({
                "name": display,
                "path": full,
                "gitnexus": has_gitnexus,
                "continuation": has_continuation,
                "claude_md": has_claude_md,
            })

    # Top-level repos (skip the nested dirs themselves)
    scan_dir(root)

    # Nested dirs (school/, not-school/)
    for nested in NESTED_DIRS:
        nested_path = os.path.join(root, nested)
        scan_dir(nested_path, group=nested)

    return repos


def main(stdscr):
    curses.curs_set(0)
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_GREEN, -1)   # selected marker
    curses.init_pair(2, curses.COLOR_YELLOW, -1)   # highlight bar
    curses.init_pair(3, curses.COLOR_RED, -1)      # missing indicator
    curses.init_pair(4, curses.COLOR_CYAN, -1)     # header
    curses.init_pair(5, curses.COLOR_WHITE, curses.COLOR_BLUE)  # status bar

    repos = discover_repos(PROJECTS_ROOT)
    if not repos:
        return []

    selected = set()
    cursor = 0
    scroll_offset = 0

    while True:
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        header_lines = 4
        footer_lines = 3
        list_height = height - header_lines - footer_lines

        # Header
        title = " REPO SELECTOR — Multi-Repo Analysis Setup "
        stdscr.addstr(0, max(0, (width - len(title)) // 2), title, curses.A_BOLD | curses.color_pair(4))
        legend = "  [Space] Toggle   [a] All   [n] None   [Enter] Confirm   [q] Quit"
        stdscr.addstr(1, 0, legend[:width-1], curses.A_DIM)

        col_hdr = f"  {'':3s} {'Repo':<36s} {'GitNexus':^10s} {'CLAUDE.md':^10s} {'CONT_PROMPT':^12s}"
        stdscr.addstr(3, 0, col_hdr[:width-1], curses.A_BOLD | curses.A_UNDERLINE)

        # Scroll management
        if cursor < scroll_offset:
            scroll_offset = cursor
        if cursor >= scroll_offset + list_height:
            scroll_offset = cursor - list_height + 1

        # Repo list
        for i in range(list_height):
            idx = scroll_offset + i
            if idx >= len(repos):
                break
            repo = repos[idx]
            row = header_lines + i

            marker = "[X]" if idx in selected else "[ ]"
            gn = " YES " if repo["gitnexus"] else "  -  "
            cm = " YES " if repo["claude_md"] else "  -  "
            cp = "  YES  " if repo["continuation"] else "   -   "

            line = f"  {marker} {repo['name']:<36s} {gn:^10s} {cm:^10s} {cp:^12s}"
            line = line[:width-1]

            if idx == cursor:
                attr = curses.A_BOLD | curses.color_pair(2)
            else:
                attr = 0

            stdscr.addstr(row, 0, line, attr)

            # Colorize status indicators on the current line
            name_end = 6 + min(36, len(repo["name"]))
            gn_col = 42
            cm_col = 52
            cp_col = 62

            if idx == cursor:
                base = curses.A_BOLD
            else:
                base = 0

            if idx in selected:
                stdscr.addstr(row, 2, marker, base | curses.color_pair(1))

            if not repo["gitnexus"] and gn_col < width - 5:
                stdscr.addstr(row, gn_col, gn.center(10)[:10], base | curses.color_pair(3))
            if not repo["claude_md"] and cm_col < width - 5:
                stdscr.addstr(row, cm_col, cm.center(10)[:10], base | curses.color_pair(3))
            if not repo["continuation"] and cp_col < width - 5:
                stdscr.addstr(row, cp_col, cp.center(12)[:12], base | curses.color_pair(3))

        # Footer / status bar
        status_row = height - 2
        count = len(selected)
        status = f" {count} repo(s) selected "
        pad = " " * (width - len(status) - 1)
        try:
            stdscr.addstr(status_row, 0, (status + pad)[:width-1], curses.color_pair(5))
        except curses.error:
            pass

        stdscr.refresh()

        key = stdscr.getch()
        if key == curses.KEY_UP or key == ord('k'):
            cursor = max(0, cursor - 1)
        elif key == curses.KEY_DOWN or key == ord('j'):
            cursor = min(len(repos) - 1, cursor + 1)
        elif key == ord(' '):
            if cursor in selected:
                selected.discard(cursor)
            else:
                selected.add(cursor)
        elif key == ord('a'):
            selected = set(range(len(repos)))
        elif key == ord('n'):
            selected.clear()
        elif key in (curses.KEY_ENTER, 10, 13):
            return [repos[i]["path"] for i in sorted(selected)]
        elif key == ord('q') or key == 27:
            return []

    return []


if __name__ == "__main__":
    result = curses.wrapper(main)
    if result:
        # Print paths to stdout for piping
        for p in result:
            print(p)
    else:
        print("(no repos selected)", file=sys.stderr)
        sys.exit(1)
