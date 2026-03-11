/**
 * schoology-classify-ai.mjs — Two-tier title parser: regex first, DeepSeek AI fallback.
 *
 * Batch multiple unknown titles into a single API call to minimize cost.
 * Results are cached persistently in state/ai-parse-cache.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './paths.mjs';
import { parseTopicFromTitle } from './schoology-classify.mjs';

// ── TLS workaround for corporate proxy ──────────────────────────────────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

// ── .env loader (manual, no dependencies) ───────────────────────────────────
if (!process.env.DEEPSEEK_API_KEY) {
  try {
    const envPath = join(AGENT_ROOT, '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const rawLine of envContent.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch { /* .env missing or unreadable — rely on process.env */ }
}

// ── Cache ───────────────────────────────────────────────────────────────────
const CACHE_PATH = join(AGENT_ROOT, 'state', 'ai-parse-cache.json');
const MAX_BATCH_SIZE = 50;

let _cache = null;

/**
 * Load the persistent cache from disk.
 * @returns {Record<string, { unit: number, lesson: number } | null>}
 */
export function loadCache() {
  if (_cache) return _cache;
  try {
    if (existsSync(CACHE_PATH)) {
      _cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    } else {
      _cache = {};
    }
  } catch (err) {
    console.warn('[classify-ai] Failed to load cache, starting fresh:', err.message);
    _cache = {};
  }
  return _cache;
}

/**
 * Save the cache to disk.
 */
export function saveCache() {
  if (!_cache) return;
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[classify-ai] Failed to save cache:', err.message);
  }
}

// ── Prompt builder ──────────────────────────────────────────────────────────

function buildBatchPrompt(items) {
  const lines = items.map((item, i) => {
    let line = `${i + 1}. "${item.title}"`;
    if (item.context?.folderPath?.length) {
      line += ` (folder: ${item.context.folderPath.join('/')})`;
    }
    if (item.context?.siblingTitles?.length) {
      line += ` (nearby: ${item.context.siblingTitles.slice(0, 5).join(', ')})`;
    }
    return line;
  });

  return `You are a parser for AP Statistics course materials on Schoology.
AP Statistics has Units 1-9, each with ~10-15 lessons.
"Topic X.Y" means Unit X, Lesson Y. Quiz titles refer to the lesson they test.

For each title below, extract the unit and lesson number.
Return a JSON array with one entry per title: {"unit": <int>, "lesson": <int>} or null.

Titles:
${lines.join('\n')}

Return ONLY a JSON array, e.g.: [{"unit":7,"lesson":2}, null, ...]`;
}

// ── DeepSeek API call ───────────────────────────────────────────────────────

async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[classify-ai] DEEPSEEK_API_KEY not set — skipping AI lookup');
    return null;
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error(`[classify-ai] DeepSeek API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.warn('[classify-ai] DeepSeek returned empty content');
      return null;
    }

    return content.trim();
  } catch (err) {
    console.error('[classify-ai] DeepSeek API call failed:', err.message);
    return null;
  }
}

// ── Response parser ─────────────────────────────────────────────────────────

function parseAIResponse(raw, expectedCount) {
  if (!raw) return null;

  try {
    // Try to extract JSON array from the response — it may have markdown fences
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[classify-ai] No JSON array found in AI response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      console.warn('[classify-ai] AI response is not an array');
      return null;
    }

    if (parsed.length !== expectedCount) {
      console.warn(`[classify-ai] Expected ${expectedCount} results, got ${parsed.length}`);
      // Try to use partial results if we got fewer
      if (parsed.length < expectedCount) {
        // Pad with nulls
        while (parsed.length < expectedCount) parsed.push(null);
      }
      // If we got more, truncate
      parsed.length = expectedCount;
    }

    // Validate each entry
    return parsed.map(entry => {
      if (entry === null) return null;
      if (typeof entry === 'object' &&
          typeof entry.unit === 'number' && Number.isInteger(entry.unit) &&
          typeof entry.lesson === 'number' && Number.isInteger(entry.lesson) &&
          entry.unit >= 1 && entry.unit <= 9 &&
          entry.lesson >= 1 && entry.lesson <= 20) {
        return { unit: entry.unit, lesson: entry.lesson };
      }
      console.warn('[classify-ai] Invalid entry in AI response:', entry);
      return null;
    });
  } catch (err) {
    console.warn('[classify-ai] Failed to parse AI response:', err.message);
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a single title, using AI fallback if regex fails.
 * @param {string} title
 * @param {{ folderPath?: string[], siblingTitles?: string[] }} context
 * @returns {Promise<{ unit: number, lesson: number, source: 'regex'|'ai'|'cache' } | null>}
 */
export async function parseTopicWithAI(title, context = {}) {
  if (!title) return null;

  // Tier 1: regex (fast, free)
  const regexResult = parseTopicFromTitle(title);
  if (regexResult) {
    return { unit: regexResult.unit, lesson: regexResult.lesson, source: 'regex' };
  }

  // Tier 2: cache check
  const cache = loadCache();
  if (title in cache) {
    const cached = cache[title];
    if (cached === null) return null;
    return { unit: cached.unit, lesson: cached.lesson, source: 'cache' };
  }

  // Tier 3: DeepSeek API
  const prompt = buildBatchPrompt([{ title, context }]);
  const raw = await callDeepSeek(prompt);
  const results = parseAIResponse(raw, 1);

  const result = results?.[0] ?? null;

  // Update cache (even for null — means "not identifiable")
  cache[title] = result;
  saveCache();

  if (result === null) return null;
  return { unit: result.unit, lesson: result.lesson, source: 'ai' };
}

/**
 * Batch parse multiple titles. Groups unknowns into a single DeepSeek API call.
 * @param {{ title: string, context?: { folderPath?: string[], siblingTitles?: string[] } }[]} items
 * @returns {Promise<Map<string, { unit: number, lesson: number, source: string } | null>>}
 */
export async function batchParseTopics(items) {
  const resultMap = new Map();
  const cache = loadCache();
  const unknowns = [];

  for (const item of items) {
    const { title, context } = item;
    if (!title) {
      resultMap.set(title, null);
      continue;
    }

    // Tier 1: regex
    const regexResult = parseTopicFromTitle(title);
    if (regexResult) {
      resultMap.set(title, { unit: regexResult.unit, lesson: regexResult.lesson, source: 'regex' });
      continue;
    }

    // Tier 2: cache
    if (title in cache) {
      const cached = cache[title];
      if (cached === null) {
        resultMap.set(title, null);
      } else {
        resultMap.set(title, { unit: cached.unit, lesson: cached.lesson, source: 'cache' });
      }
      continue;
    }

    // Tier 3: queue for AI
    unknowns.push({ title, context: context ?? {} });
  }

  // If no unknowns, we're done
  if (unknowns.length === 0) return resultMap;

  // Check for API key before attempting batch
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn(`[classify-ai] DEEPSEEK_API_KEY not set — ${unknowns.length} title(s) unresolved`);
    for (const item of unknowns) {
      cache[item.title] = null;
      resultMap.set(item.title, null);
    }
    saveCache();
    return resultMap;
  }

  // Split unknowns into chunks of MAX_BATCH_SIZE
  const chunks = [];
  for (let i = 0; i < unknowns.length; i += MAX_BATCH_SIZE) {
    chunks.push(unknowns.slice(i, i + MAX_BATCH_SIZE));
  }

  for (const chunk of chunks) {
    const prompt = buildBatchPrompt(chunk);
    const raw = await callDeepSeek(prompt);
    const results = parseAIResponse(raw, chunk.length);

    for (let i = 0; i < chunk.length; i++) {
      const title = chunk[i].title;
      const result = results?.[i] ?? null;

      // Update cache
      cache[title] = result;

      if (result === null) {
        resultMap.set(title, null);
      } else {
        resultMap.set(title, { unit: result.unit, lesson: result.lesson, source: 'ai' });
      }
    }
  }

  // Save cache once at end
  saveCache();

  return resultMap;
}

export default {
  parseTopicWithAI,
  batchParseTopics,
  loadCache,
  saveCache,
};
