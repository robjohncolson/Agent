/**
 * llm-check.mjs — DeepSeek API wrapper for semantic validation.
 *
 * Provides two functions:
 *   - checkWithLLM(prompt, content) — validate content against a prompt
 *   - analyzeError(errorOutput, context) — diagnose pipeline errors
 *
 * Graceful degradation: if DEEPSEEK_API_KEY is not set, all checks
 * return { ok: true } with a "skipped" note. Pipeline runs identically.
 */

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT = 30000;
const MAX_TOKENS = 500;

// In-memory cache keyed by content hash (lasts one pipeline run)
const cache = new Map();

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function getApiKey() {
  return process.env.DEEPSEEK_API_KEY || null;
}

/**
 * Validate content against a prompt using DeepSeek.
 * @param {string} prompt - The validation instruction
 * @param {string} content - The content to validate
 * @param {{ timeout?: number }} options
 * @returns {Promise<{ ok: boolean, issues: string[], raw: string }>}
 */
export async function checkWithLLM(prompt, content, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: true, issues: [], raw: "skipped (no API key)" };
  }

  const cacheKey = simpleHash(prompt + content);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "system",
            content:
              'You are a validation assistant. Respond ONLY with JSON: { "ok": true/false, "issues": ["..."] }. ' +
              "If everything looks correct, respond with { \"ok\": true, \"issues\": [] }.",
          },
          {
            role: "user",
            content: `${prompt}\n\n---\n\n${content}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: true,
        issues: [`LLM check unavailable: HTTP ${response.status}`],
        raw: errText,
      };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";

    try {
      // Try to extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        const result = { ok: false, issues: ["LLM returned non-JSON response"], raw: text };
        cache.set(cacheKey, result);
        return result;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const result = {
        ok: Boolean(parsed.ok),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        raw: text,
      };
      cache.set(cacheKey, result);
      return result;
    } catch {
      const result = { ok: false, issues: ["LLM returned non-JSON response"], raw: text };
      cache.set(cacheKey, result);
      return result;
    }
  } catch (err) {
    return {
      ok: true,
      issues: [`LLM check unavailable: ${err.message}`],
      raw: "",
    };
  }
}

/**
 * Analyze a pipeline error using DeepSeek for diagnosis.
 * @param {string} errorOutput - The error text/output
 * @param {{ step?: string, unit?: number, lesson?: number }} context
 * @returns {Promise<{ diagnosis: string, suggestedFix: string, raw: string }>}
 */
export async function analyzeError(errorOutput, context = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { diagnosis: "", suggestedFix: "", raw: "skipped (no API key)" };
  }

  const truncated = errorOutput.length > 2000
    ? errorOutput.slice(-2000)
    : errorOutput;

  const contextStr = [
    context.step && `Step: ${context.step}`,
    context.unit && `Unit: ${context.unit}`,
    context.lesson && `Lesson: ${context.lesson}`,
  ]
    .filter(Boolean)
    .join(", ");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "system",
            content:
              "You are a build/pipeline error analyst. Respond with JSON: " +
              '{ "diagnosis": "...", "suggestedFix": "..." }. Be concise.',
          },
          {
            role: "user",
            content:
              `A lesson-prep pipeline step failed. Analyze the error and suggest a fix.\n` +
              `${contextStr ? contextStr + "\n" : ""}` +
              `Error output:\n${truncated}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!response.ok) {
      return { diagnosis: "", suggestedFix: "", raw: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { diagnosis: text, suggestedFix: "", raw: text };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        diagnosis: parsed.diagnosis || "",
        suggestedFix: parsed.suggestedFix || "",
        raw: text,
      };
    } catch {
      return { diagnosis: text, suggestedFix: "", raw: text };
    }
  } catch (err) {
    return { diagnosis: "", suggestedFix: "", raw: `Error: ${err.message}` };
  }
}
