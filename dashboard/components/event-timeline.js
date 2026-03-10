/**
 * event-timeline.js — Reverse-chronological event feed.
 * Queries agent_events table, renders as a feed with expandable payloads.
 */

import { query } from '../lib/supabase-client.js';
import { formatDate, statusBadge, timeAgo, escapeHtml } from '../lib/formatters.js';

export async function render(container) {
  const { data, error } = await query('agent_events', {
    order: 'created_at',
    ascending: false,
    limit: 100
  });

  if (error || !data) {
    container.innerHTML = `<p class="card-detail">Failed to load events: ${error || 'no data'}</p>`;
    return;
  }

  if (data.length === 0) {
    container.innerHTML = '<p class="card-detail">No events recorded yet.</p>';
    return;
  }

  container.innerHTML = data.map(ev => `
    <div class="feed-item fade-in">
      <span class="feed-time">${timeAgo(ev.created_at)}</span>
      <span class="feed-body">
        ${statusBadge(ev.data?.status || ev.event_type.split('.').pop())}
        <strong>${escapeHtml(ev.event_type)}</strong>
        ${ev.data?.step ? `— step: ${escapeHtml(ev.data.step)}` : ''}
        ${ev.data?.pipeline ? `(${escapeHtml(ev.data.pipeline)})` : ''}
        ${ev.machine ? `<span class="card-detail">@ ${escapeHtml(ev.machine)}</span>` : ''}
      </span>
    </div>
  `).join('');
}
