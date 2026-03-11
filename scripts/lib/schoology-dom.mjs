/**
 * schoology-dom.mjs — Shared Schoology DOM interaction helpers via Playwright CDP.
 *
 * All selectors are battle-tested against live Schoology (probed 2026-03-09).
 * Every function takes a Playwright `page` object. All page.evaluate() calls
 * use native DOM selectors only (no Playwright-specific pseudo-selectors like :has-text).
 */

const VALID_COLORS = ["blue","red","orange","yellow","green","purple","pink","black","gray"];
const COLOR_VALUES = { blue: 0, red: 1, orange: 2, yellow: 3, green: 4, purple: 5, pink: 6, black: 7, gray: 8 };
export const COURSE_IDS = { B: '7945275782', E: '7945275798' };

// ── Utilities ────────────────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export { VALID_COLORS, COLOR_VALUES };

// ── Navigation ───────────────────────────────────────────────────────────────

/**
 * Navigate to a folder in Schoology materials. If folderId is null, goes to top level.
 */
export async function navigateToFolder(page, courseId, folderId = null) {
  let url = `https://lynnschools.schoology.com/course/${courseId}/materials`;
  if (folderId) url += `?f=${folderId}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);
}

/**
 * Build the materials URL for a course + optional folder.
 */
export function materialsUrl(courseId, folderId = null) {
  let url = `https://lynnschools.schoology.com/course/${courseId}/materials`;
  if (folderId) url += `?f=${folderId}`;
  return url;
}

// ── Popup Waiting ────────────────────────────────────────────────────────────

/**
 * Wait for a Schoology popup (.popups-box) to appear and be visible.
 */
export async function waitForPopup(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hasPopup = await page.evaluate(() => {
      const popup = document.querySelector('.popups-box');
      return popup && popup.style.display !== 'none' && popup.offsetParent !== null;
    });
    if (hasPopup) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Wait for a Schoology popup to close. Handles navigation-destroyed context gracefully.
 */
export async function waitForPopupClose(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const noPopup = await page.evaluate(() => {
        const popup = document.querySelector('.popups-box');
        return !popup || popup.style.display === 'none';
      });
      if (noPopup) return true;
    } catch {
      // Navigation destroyed context — popup is gone
      return true;
    }
    await sleep(500);
  }
  return false;
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * List all items (folders and links) at the current folder level.
 * Returns array of { id, name, type: 'folder'|'link'|'discussion', color?, href }
 */
export async function listItems(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr');
    const items = [];
    for (const r of rows) {
      if (r.id.startsWith('f-')) {
        const a = r.querySelector('.item-title a, td a');
        const colorSpan = r.querySelector('span[class*="folder-color"]');
        const colorMatch = colorSpan ? colorSpan.className.match(/folder-color-(\w+)/) : null;
        items.push({
          id: r.id.replace('f-', ''),
          name: a ? a.textContent.trim() : '',
          type: 'folder',
          color: colorMatch ? colorMatch[1] : 'blue',
          href: a ? a.href : ''
        });
      } else if (r.id.startsWith('n-')) {
        const a = r.querySelector('.item-title a, td a');
        items.push({
          id: r.id.replace('n-', ''),
          name: a ? a.textContent.trim() : '',
          type: r.className.includes('type-discussion') ? 'discussion' : 'link',
          href: a ? a.href : ''
        });
      }
    }
    return items;
  });
}

/**
 * Find a folder by name at the current page level.
 */
export async function findFolderByName(page, name) {
  const items = await listItems(page);
  return items.find(i => i.type === 'folder' && i.name === name) || null;
}

/**
 * Resolve a folder reference (name string or numeric ID) by navigating to
 * top level and searching. Returns { id, name } or null.
 */
export async function resolveFolder(page, courseId, ref) {
  // If it looks like an ID (all digits), just use it directly
  if (/^\d+$/.test(String(ref))) {
    return { id: String(ref), name: ref };
  }
  // Otherwise search top-level folders for the name
  await navigateToFolder(page, courseId);
  const items = await listItems(page);
  const match = items.find(i => i.type === 'folder' && i.name === ref);
  return match || null;
}

// ── Folder Path Navigation ──────────────────────────────────────────────────

/**
 * Navigate through a folder hierarchy by name, creating missing folders along
 * the way if `createMissing` is true. Returns the final folder ID.
 *
 * @param {Page} page - Playwright page
 * @param {string} courseId - Schoology course ID
 * @param {string[]} pathSegments - e.g., ["Q3", "week 24"]
 * @param {{ createMissing?: boolean }} options
 * @returns {Promise<string>} - folder ID of the deepest segment
 */
export async function navigatePath(page, courseId, pathSegments, { createMissing = false } = {}) {
  let currentFolderId = null;

  for (const segment of pathSegments) {
    await navigateToFolder(page, courseId, currentFolderId);
    const items = await listItems(page);
    const match = items.find(
      i => i.type === 'folder' && i.name.toLowerCase() === segment.toLowerCase()
    );

    if (match) {
      currentFolderId = match.id;
    } else if (createMissing) {
      // Create the missing folder at the current level
      await clickAddMaterials(page);
      await clickAddFolder(page);
      await fillFolderForm(page, { name: segment });
      await submitPopup(page);

      // Re-list to find the newly created folder
      await navigateToFolder(page, courseId, currentFolderId);
      const refreshed = await listItems(page);
      const created = refreshed.find(
        i => i.type === 'folder' && i.name.toLowerCase() === segment.toLowerCase()
      );
      if (!created) {
        throw new Error(`Failed to create folder "${segment}" — not found after creation`);
      }
      currentFolderId = created.id;
      console.log(`  Created folder: "${segment}" (id: ${currentFolderId})`);
    } else {
      const available = items.filter(i => i.type === 'folder').map(i => i.name);
      throw new Error(
        `Folder "${segment}" not found. Available: ${available.join(', ') || '(none)'}`
      );
    }
  }

  return currentFolderId;
}

// ── Folder Creation ──────────────────────────────────────────────────────────

/**
 * Click the "Add Materials" button (text-matched span).
 */
export async function clickAddMaterials(page) {
  await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const s of spans) {
      if (s.textContent.trim() === 'Add Materials') {
        s.click();
        return;
      }
    }
  });
  await sleep(1500);
}

/**
 * Click the "Add Folder" link in the Add Materials dropdown.
 */
export async function clickAddFolder(page) {
  // Use Playwright's native click — page.evaluate clicks don't trigger
  // Schoology's popups-processed handlers inside subfolder contexts.
  try {
    await page.click('a:has-text("Add Folder")', { timeout: 5000 });
  } catch {
    // Fallback to evaluate click for older DOM states
    await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        if (a.textContent.trim() === 'Add Folder') {
          a.click();
          return;
        }
      }
    });
  }
  await sleep(2000);
}

/**
 * Fill the folder creation/edit form inside the popup.
 * @param {object} opts - { name: string, color?: string }
 */
export async function fillFolderForm(page, { name, color = null }) {
  // Fill title
  const titleField = await page.$('#edit-title');
  if (titleField) {
    await titleField.fill(name);
  }
  await sleep(300);

  // Set color if specified
  if (color && color !== 'blue') {
    const colorValue = COLOR_VALUES[color];
    if (colorValue !== undefined) {
      await page.evaluate((c) => {
        // Click the color swatch
        const swatch = document.querySelector(`div.s-js-color-select[data-color="${c}"]`);
        if (swatch) swatch.click();
      }, color);
      await sleep(300);
    }
  }
}

// ── Popup Submit ─────────────────────────────────────────────────────────────

/**
 * Click #edit-submit inside the popup and wait for it to close.
 */
export async function submitPopup(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('#edit-submit');
    if (btn) btn.click();
  });
  await waitForPopupClose(page);
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch { /* may already be idle */ }
  await sleep(1500);
}

// ── Folder Move ──────────────────────────────────────────────────────────────

/**
 * Open the gear/options menu for a folder row.
 * @param {string} rowId - The full row ID (e.g. "f-986796249")
 */
export async function openGearMenu(page, rowId) {
  await page.click(`#${rowId} .action-links-unfold`);
  await sleep(1000);
}

/**
 * Click the "Move" option in an already-open gear dropdown.
 * @param {string} rowId - The full row ID
 */
export async function clickMoveOption(page, rowId) {
  await page.click(`#${rowId} a.move-material`);
}

/**
 * In the Move popup, select a target folder from the #edit-destination-folder dropdown.
 * The dropdown uses "--" indentation per nesting level; we strip those for matching.
 * @returns {{ found: boolean, value?: string, text?: string }}
 */
export async function selectMoveTarget(page, targetName) {
  return page.evaluate((name) => {
    const sel = document.querySelector('#edit-destination-folder');
    if (!sel) return { found: false, error: 'no select found' };

    for (const opt of sel.options) {
      // Strip leading dashes and spaces used for indentation
      const clean = opt.textContent.trim().replace(/^[-\s]+/, '');
      if (clean === name || opt.textContent.trim() === name) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, value: opt.value, text: opt.textContent.trim() };
      }
    }
    return { found: false };
  }, targetName);
}

/**
 * Get all options from the move destination dropdown (for error reporting).
 */
export async function getMoveOptions(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('#edit-destination-folder');
    if (!sel) return [];
    return Array.from(sel.options).map(o => ({
      value: o.value,
      text: o.textContent.trim()
    }));
  });
}

/**
 * Click the "Edit" option in an already-open gear dropdown for a folder row.
 * @param {string} rowId - The full row ID (e.g. "f-986796249")
 */
export async function clickEditFolder(page, rowId) {
  // Try class-based selector first, then fall back to text matching
  const clicked = await page.evaluate((rid) => {
    const row = document.getElementById(rid);
    if (!row) return false;

    // Try common Schoology edit link selectors
    const byClass = row.querySelector('a.edit-folder, a.action-edit, a[href*="/edit"]');
    if (byClass) { byClass.click(); return true; }

    // Fallback: text-match "Edit" in the action links area
    const links = row.querySelectorAll('.action-links a, .operations a, a');
    for (const a of links) {
      const text = a.textContent.trim().toLowerCase();
      if (text === 'edit' || text === 'edit folder') {
        a.click();
        return true;
      }
    }
    return false;
  }, rowId);

  if (!clicked) {
    throw new Error(`Could not find Edit option in gear menu for ${rowId}`);
  }
  await sleep(1500);
}

// ── Copy to Course ──────────────────────────────────────────────────────────

/**
 * Click "Copy to Course" in an already-open gear dropdown.
 * @param {string} rowId - The full row ID (e.g. "n-8284383200")
 */
export async function clickCopyToCourse(page, rowId) {
  const clicked = await page.evaluate((rid) => {
    const row = document.getElementById(rid);
    if (!row) return false;
    const link = row.querySelector('a[href*="/copy"]');
    if (link) { link.click(); return true; }
    // Fallback: text match
    const links = row.querySelectorAll('.action-links a, a');
    for (const a of links) {
      if (a.textContent.trim() === 'Copy to Course') {
        a.click();
        return true;
      }
    }
    return false;
  }, rowId);
  if (!clicked) throw new Error(`Copy to Course link not found for ${rowId}`);
  await sleep(500);
}

/**
 * In the Copy to Course popup, check a course checkbox and select the target folder.
 * @param {string} targetCourseId - e.g. "7945275798"
 * @param {string} targetFolderId - e.g. "986896839"
 * @returns {{ success: boolean, error?: string }}
 */
export async function selectCopyTarget(page, targetCourseId, targetFolderId) {
  return page.evaluate(({ courseId, folderId }) => {
    const cb = document.getElementById(`edit-addl-realms-${courseId}-selected`);
    if (!cb) return { success: false, error: `Checkbox for course ${courseId} not found` };

    // Check the checkbox
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));

    // Show the advanced options wrapper (folder dropdown)
    const wrapper = cb.closest('.addl-course')?.querySelector('.advanced-options-wrapper');
    if (wrapper) wrapper.style.display = '';

    // Select the folder
    const select = document.getElementById(`edit-addl-realms-${courseId}-destination-folder`);
    if (!select) return { success: false, error: `Folder dropdown for course ${courseId} not found` };

    // Verify the option exists
    let found = false;
    for (const opt of select.options) {
      if (opt.value === folderId) { found = true; break; }
    }
    if (!found) {
      const available = [...select.options].slice(0, 10).map(o => `${o.value}:${o.text.trim()}`);
      return { success: false, error: `Folder ${folderId} not in dropdown. First 10: ${available.join('; ')}` };
    }

    select.value = folderId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }, { courseId: targetCourseId, folderId: targetFolderId });
}

/**
 * Submit the Copy to Course popup form.
 */
export async function submitCopyPopup(page) {
  await page.evaluate(() => {
    const popup = document.querySelector('.popups-box');
    if (!popup) return;
    const btn = popup.querySelector('input[type="submit"], button[type="submit"], .form-submit');
    if (btn) btn.click();
  });
  await waitForPopupClose(page);
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch { /* may already be idle */ }
  await sleep(1500);
}

/**
 * Submit the move popup (same as submitPopup but semantically distinct).
 */
export async function submitMovePopup(page) {
  await page.evaluate(() => {
    const popup = document.querySelector('.popups-box');
    if (!popup) return;
    const btn = popup.querySelector('input[type="submit"], button[type="submit"]');
    if (btn) btn.click();
  });
  await waitForPopupClose(page);
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch { /* may already be idle */ }
  await sleep(1500);
}

// ── Link Posting ─────────────────────────────────────────────────────────────

/**
 * Click "Add File/Link/External Tool" in the Add Materials dropdown.
 */
export async function clickAddFileLink(page) {
  await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if (a.textContent.trim().includes('File/Link/External Tool')) {
        a.click();
        return;
      }
    }
  });
  await sleep(1500);
}

/**
 * Click the "Link" option (a.action-create-link) to open the link creation form.
 */
export async function clickLinkOption(page) {
  await page.evaluate(() => {
    const specific = document.querySelector('a.action-create-link');
    if (specific) { specific.click(); return; }
    // Fallback: find by text among visible links
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if (a.textContent.trim() === 'Link' && a.offsetParent !== null) {
        a.click();
        return;
      }
    }
  });
}

/**
 * Fill the link creation form fields.
 * @param {object} opts - { title: string, url: string }
 */
export async function fillLinkForm(page, { title, url }) {
  const urlField = await page.$('#edit-link');
  if (urlField) await urlField.fill(url);
  await sleep(300);

  const titleField = await page.$('#edit-link-title');
  if (titleField) await titleField.fill(title);
  await sleep(300);
}
