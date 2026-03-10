/**
 * repo-health.js — Repo status from registry, cross-referenced with checkpoints.
 */

import { query } from '../lib/supabase-client.js';
import { staleness, formatDate } from '../lib/formatters.js';

// Bundled at build time or fetched. For now, fetch from repo root.
async function loadRepos() {
  try {
    const res = await fetch('repos.json');
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  // Fallback: hardcoded from registry
  return [
    { id: 'agent', name: 'Agent', description: 'LLM routing hub' },
    { id: 'lrsl-driller', name: 'lrsl-driller', description: 'AP Stats drill engine' },
    { id: 'apstats-live-worksheet', name: 'apstats-live-worksheet', description: 'Live worksheets' },
    { id: 'curriculum-render', name: 'curriculum_render', description: 'Curriculum renderer' },
  ];
}

export async function render(container) {
  const [repos, checkpointResult] = await Promise.all([
    loadRepos(),
    query('agent_checkpoints', { order: 'created_at', ascending: false, limit: 20 })
  ]);

  const checkpoints = checkpointResult.data || [];

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Repo</th><th>Description</th><th>Last Checkpoint</th><th>Machine</th><th>Freshness</th>
      </tr></thead>
      <tbody>
        ${repos.map(repo => {
          const cp = checkpoints.find(c => (c.session_data?.current_project || '').includes(repo.id));
          const s = cp ? staleness(cp.created_at) : { text: 'no data', level: 'stale' };
          return `
            <tr class="fade-in">
              <td><strong>${repo.name || repo.id}</strong></td>
              <td class="card-detail">${repo.description || '—'}</td>
              <td>${cp ? formatDate(cp.created_at) : '—'}</td>
              <td>${cp?.machine_id || '—'}</td>
              <td><span class="badge badge-${s.level === 'fresh' ? 'green' : s.level === 'warn' ? 'yellow' : 'red'}">${s.text}</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}
