/**
 * formatters.js — Shared formatting helpers for the Agent Hub dashboard.
 * No dependencies. Pure functions only.
 */

/** Escape HTML special characters to prevent XSS */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format ISO timestamp to locale string */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Format seconds to human-readable duration */
export function formatDurationSec(sec) {
  return formatDuration(sec * 1000);
}

/** Calculate staleness from ISO timestamp. Returns { text, level } */
export function staleness(iso) {
  if (!iso) return { text: 'never', level: 'stale' };
  const ageMs = Date.now() - new Date(iso).getTime();
  const hours = ageMs / 3600000;
  if (hours < 1) return { text: `${Math.round(hours * 60)}m ago`, level: 'fresh' };
  if (hours < 2) return { text: `${hours.toFixed(1)}h ago`, level: 'fresh' };
  if (hours < 24) return { text: `${Math.round(hours)}h ago`, level: 'warn' };
  return { text: `${Math.round(hours / 24)}d ago`, level: 'stale' };
}

/** Return a status badge HTML string */
export function statusBadge(status) {
  const colors = {
    done: 'badge-green', completed: 'badge-green', running: 'badge-yellow',
    failed: 'badge-red', skipped: 'badge-gray', timeout: 'badge-red'
  };
  const cls = colors[status] || 'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(status) || 'unknown'}</span>`;
}

/** Map staleness level to badge CSS class */
export function stalenessClass(level) {
  const map = { fresh: 'badge-green', warn: 'badge-yellow', stale: 'badge-red' };
  return map[level] || 'badge-gray';
}

/** Relative time (e.g. "3 minutes ago") */
export function timeAgo(iso) {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
