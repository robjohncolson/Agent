/**
 * checkpoint-view.js — Checkpoint history with staleness indicators.
 */

import { query } from '../lib/supabase-client.js';
import { formatDate, staleness, stalenessClass, escapeHtml } from '../lib/formatters.js';

export async function render(container) {
  const { data, error } = await query('agent_checkpoints', {
    order: 'created_at',
    ascending: false,
    limit: 50
  });

  if (error || !data) {
    container.innerHTML = `<p class="card-detail">Failed to load checkpoints: ${error?.message || JSON.stringify(error) || 'no data'}</p>`;
    return;
  }

  if (data.length === 0) {
    container.innerHTML = '<p class="card-detail">No checkpoints recorded yet.</p>';
    return;
  }

  // Detect gaps > 2 hours
  const rows = data.map((cp, i) => {
    const gap = i < data.length - 1
      ? (new Date(cp.created_at) - new Date(data[i + 1].created_at)) / 3600000
      : 0;
    const s = staleness(cp.created_at);
    return { ...cp, gap, staleness: s };
  });

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Time</th><th>Machine</th><th>Trigger</th><th>Commit</th><th>Staleness</th><th>Gap</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="fade-in">
            <td>${formatDate(r.created_at)}</td>
            <td>${escapeHtml(r.machine_id) || '—'}</td>
            <td>${escapeHtml(r.trigger) || '—'}</td>
            <td><code>${escapeHtml((r.commit_hash || '—').slice(0, 7))}</code></td>
            <td><span class="badge ${stalenessClass(r.staleness.level)}">${escapeHtml(r.staleness.text)}</span></td>
            <td>${r.gap > 2 ? `<span class="badge badge-yellow">${r.gap.toFixed(1)}h gap</span>` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
