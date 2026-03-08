/**
 * verify-supabase.mjs — Verify that uploaded Supabase assets are publicly accessible.
 *
 * Performs HTTP HEAD requests against expected asset URLs to confirm
 * they return 200. Used by lesson-prep.mjs after Step 4 (upload).
 */

/**
 * Verify a list of Supabase asset URLs are publicly accessible.
 * @param {string[]} urls - Array of full Supabase public URLs
 * @param {{ timeout?: number }} options
 * @returns {Promise<{ verified: string[], failed: { url: string, status: number, error?: string }[] }>}
 */
export async function verifySupabaseAssets(urls, options = {}) {
  const timeout = options.timeout ?? 10000;
  const verified = [];
  const failed = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) {
          verified.push(url);
        } else {
          failed.push({ url, status: response.status });
        }
      } catch (err) {
        failed.push({ url, status: 0, error: err.message });
      }
    })
  );

  return { verified, failed };
}
