/**
 * app.js — Main dashboard orchestration.
 * Handles tab routing, auto-refresh, and component lifecycle.
 */

import { getClient } from './lib/supabase-client.js';

// Dynamic component imports
const components = {};

async function loadComponent(name) {
  if (components[name]) return components[name];
  const mod = await import(`./components/${name}.js`);
  components[name] = mod;
  return mod;
}

// State
let activeView = 'pipeline';
let refreshTimer = null;

const VIEW_MAP = {
  pipeline: 'pipeline-view',
  timeline: 'event-timeline',
  checkpoints: 'checkpoint-view',
  repos: 'repo-health'
};

// Tab switching
function switchView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${view}`);
    el.classList.toggle('hidden', el.id !== `view-${view}`);
  });
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  refreshCurrentView();
}

// Refresh
async function refreshCurrentView() {
  const el = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  el.classList.remove('hidden');
  errorEl.classList.add('hidden');

  try {
    const componentName = VIEW_MAP[activeView];
    const component = await loadComponent(componentName);
    const container = document.querySelector(`#view-${activeView}`);
    await component.render(container);
  } catch (err) {
    errorEl.textContent = `Error: ${err.message}`;
    errorEl.classList.remove('hidden');
  } finally {
    el.classList.add('hidden');
  }
}

// Auto-refresh
function toggleAutoRefresh(enabled) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (enabled) {
    refreshTimer = setInterval(refreshCurrentView, 30000);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Tab clicks
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Auto-refresh toggle
  const autoRefreshCb = document.getElementById('auto-refresh');
  autoRefreshCb.addEventListener('change', () => toggleAutoRefresh(autoRefreshCb.checked));

  // Check Supabase connectivity
  const client = getClient();
  if (!client) {
    document.getElementById('error').textContent = 'Supabase not configured. Set meta tags in index.html.';
    document.getElementById('error').classList.remove('hidden');
    return;
  }

  // Initial load
  switchView('pipeline');
});
