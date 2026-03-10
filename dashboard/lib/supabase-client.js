/**
 * supabase-client.js — Initialize Supabase client from meta tags.
 *
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from <meta> tags in index.html.
 * Falls back to window.__SUPABASE_URL / __SUPABASE_ANON_KEY for testing.
 */

function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.content : null;
}

const SUPABASE_URL = getMeta('supabase-url') || window.__SUPABASE_URL || '';
const SUPABASE_ANON_KEY = getMeta('supabase-anon-key') || window.__SUPABASE_ANON_KEY || '';

let _client = null;

export function getClient() {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[supabase-client] Missing SUPABASE_URL or SUPABASE_ANON_KEY meta tags');
    return null;
  }
  // Use supabase-js from CDN (loaded in index.html)
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

/** Helper: run a select query. Returns { data, error }. */
export async function query(table, options = {}) {
  const client = getClient();
  if (!client) return { data: null, error: 'No Supabase client' };

  let q = client.from(table).select(options.select || '*');
  if (options.order) q = q.order(options.order, { ascending: options.ascending ?? false });
  if (options.limit) q = q.limit(options.limit);
  if (options.gte) q = q.gte(options.gte[0], options.gte[1]);
  if (options.eq) q = q.eq(options.eq[0], options.eq[1]);

  const { data, error } = await q;
  if (error) console.warn(`[supabase-client] query ${table} error:`, error);
  return { data, error };
}
