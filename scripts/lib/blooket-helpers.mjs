/**
 * blooket-helpers.mjs - Shared Playwright helpers for Blooket automation.
 *
 * Usage:
 *   import {
 *     dismissCookieBanner,
 *     scrollToLoadAll,
 *     confirmModal,
 *     findSetContainer,
 *   } from "./lib/blooket-helpers.mjs";
 */

const MODAL_SELECTOR = '[class*="_modal"]';

/**
 * Return the first visible modal element on the page.
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<import("playwright").ElementHandle<HTMLElement>|null>}
 */
async function getVisibleModalHandle(page) {
  const handle = await page.evaluateHandle((selector) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const hasActionText = (modal) => {
      const candidates = modal.querySelectorAll("button, [role='button'], div, span");
      return Array.from(candidates).some((candidate) => {
        const text = (candidate.textContent || "").trim();
        return text === "Yes" || text === "No";
      });
    };

    const modals = Array.from(document.querySelectorAll(selector));
    const visibleModals = modals.filter((modal) => isVisible(modal));

    return (
      visibleModals.find((modal) => {
        const text = (modal.textContent || "").trim();
        return text && hasActionText(modal);
      }) ||
      visibleModals.find((modal) => (modal.textContent || "").trim()) ||
      visibleModals[0] ||
      null
    );
  }, MODAL_SELECTOR);

  const modal = handle.asElement();
  if (!modal) {
    await handle.dispose();
    return null;
  }

  return modal;
}

/**
 * Dismiss the Blooket cookie banner if it is present.
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<void>}
 */
export async function dismissCookieBanner(page) {
  try {
    const acceptButton = page.locator("button.cky-btn-accept").first();
    const exists = (await acceptButton.count()) > 0;
    if (!exists) {
      return;
    }

    const isVisible = await acceptButton.isVisible().catch(() => false);

    if (!isVisible) {
      return;
    }

    await acceptButton.click();
    await page.waitForTimeout(500);
  } catch {
    // Intentionally ignore missing or transient cookie-banner failures.
  }
}

/**
 * Scroll until lazily loaded content stops extending the page.
 *
 * @param {import("playwright").Page} page
 * @param {object} [options]
 * @param {number} [options.maxIterations=20]
 * @param {number} [options.scrollStep=400]
 * @param {number} [options.settleMs=300]
 * @returns {Promise<{scrollHeight: number, iterations: number}>}
 */
export async function scrollToLoadAll(
  page,
  { maxIterations = 20, scrollStep = 400, settleMs = 300 } = {}
) {
  let scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  let unchangedIterations = 0;
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    await page.evaluate((step) => {
      window.scrollBy(0, step);
    }, scrollStep);

    await page.waitForTimeout(settleMs);

    const nextScrollHeight = await page.evaluate(() => document.body.scrollHeight);
    iterations = i + 1;

    if (nextScrollHeight === scrollHeight) {
      unchangedIterations += 1;
    } else {
      unchangedIterations = 0;
      scrollHeight = nextScrollHeight;
    }

    if (unchangedIterations >= 2) {
      break;
    }
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });

  return { scrollHeight, iterations };
}

/**
 * Confirm a visible modal if its text matches the expected confirmation copy.
 *
 * @param {import("playwright").Page} page
 * @param {string} expectedText
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<{confirmed: boolean, modalText: string|null}>}
 */
export async function confirmModal(
  page,
  expectedText,
  { timeoutMs = 3000 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let modal = null;

  while (Date.now() < deadline) {
    modal = await getVisibleModalHandle(page);
    if (modal) {
      break;
    }

    await page.waitForTimeout(100);
  }

  if (!modal) {
    return { confirmed: false, modalText: null };
  }

  const modalText = ((await modal.textContent()) || "").trim();
  const expectsConfirmation = modalText.includes(expectedText);

  try {
    if (!expectsConfirmation) {
      const cancelButton = await modal.$('text="No"');

      if (cancelButton) {
        await cancelButton.click();
      }

      return { confirmed: false, modalText };
    }

    const confirmButton = await modal.$('text="Yes"');

    if (!confirmButton) {
      return { confirmed: false, modalText };
    }

    await confirmButton.click();
    await page.waitForTimeout(2000);
    return { confirmed: true, modalText };
  } finally {
    await modal.dispose();
  }
}

/**
 * Find the set card container for the given set ID.
 *
 * @param {import("playwright").Page} page
 * @param {string} setId
 * @returns {Promise<import("playwright").ElementHandle<HTMLElement>|null>}
 */
export async function findSetContainer(page, setId) {
  const link = await page.$(`a[href="/set/${setId}"]`);
  if (!link) {
    return null;
  }

  const handle = await link.evaluateHandle((element) => {
    let current = element;

    while (current) {
      const className =
        typeof current.className === "string" ? current.className : "";
      if (className.includes("_setContainer")) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  });

  await link.dispose();

  const container = handle.asElement();
  if (!container) {
    await handle.dispose();
    return null;
  }

  await container.scrollIntoViewIfNeeded();
  return container;
}
