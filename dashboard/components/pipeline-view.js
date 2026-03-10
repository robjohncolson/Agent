/**
 * pipeline-view.js — Pipeline runs grouped by pipeline_run_id or timestamp.
 * Shows step-by-step progress with timing and status.
 */

import { query } from '../lib/supabase-client.js';
import { formatDate, formatDuration, statusBadge, escapeHtml } from '../lib/formatters.js';

export async function render(container) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await query('agent_events', {
    order: 'created_at',
    ascending: false,
    limit: 500,
    gte: ['created_at', sevenDaysAgo],
    eq: ['category', 'pipeline']
  });

  if (error || !data) {
    container.innerHTML = `<p class="card-detail">Failed to load pipeline data: ${error || 'no data'}</p>`;
    return;
  }

  // Group by pipeline runs (cluster pipeline.started -> pipeline.completed sequences)
  const runs = groupPipelineRuns(data);

  if (runs.length === 0) {
    container.innerHTML = '<p class="card-detail">No pipeline runs in the last 7 days.</p>';
    return;
  }

  container.innerHTML = runs.map(run => `
    <div class="card fade-in">
      <div class="card-header">
        <h3>${escapeHtml(run.name) || 'pipeline'} — ${formatDate(run.startedAt)}</h3>
        ${statusBadge(run.status)}
      </div>
      <div class="card-detail">
        ${run.steps.map(s => `
          <div class="feed-item" style="border:none;padding:0.3rem 0">
            ${statusBadge(s.status)}
            <span>${escapeHtml(s.step)}</span>
            ${s.duration ? `<span class="card-detail">${formatDuration(s.duration)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function groupPipelineRuns(events) {
  const runs = [];
  let current = null;

  // Events are newest-first, reverse for chronological processing
  const sorted = [...events].reverse();

  for (const ev of sorted) {
    if (ev.event_type === 'pipeline.started') {
      current = {
        name: ev.data?.pipeline || 'pipeline',
        startedAt: ev.created_at,
        status: 'running',
        steps: []
      };
      runs.push(current);
    } else if (ev.event_type === 'pipeline.completed' && current) {
      current.status = 'done';
      current = null;
    } else if (ev.event_type.startsWith('pipeline.step.') && current) {
      const action = ev.event_type.split('.').pop(); // started, completed, failed
      const stepName = ev.data?.step || '?';
      const existing = current.steps.find(s => s.step === stepName);
      if (existing) {
        if (action === 'completed') { existing.status = 'done'; existing.duration = ev.data?.duration_ms; }
        else if (action === 'failed') { existing.status = 'failed'; }
      } else {
        current.steps.push({
          step: stepName,
          status: action === 'completed' ? 'done' : action === 'failed' ? 'failed' : 'running',
          duration: ev.data?.duration_ms
        });
      }
    }
  }
  return runs.reverse(); // newest first
}
