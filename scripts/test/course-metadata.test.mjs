import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLinkTitles,
  computeQuizTitle,
  computeUrls,
  getCartridgeId,
  resolveDrillsLink,
} from "../lib/course-metadata.mjs";
import { buildExpectedLinks } from "../lib/schoology-heal.mjs";

test("computeUrls derives each topic's own quiz URL", () => {
  // Each topic links to its OWN quiz (?u=X&l=N). Unit-opener topics (X.1)
  // have no quiz of their own (cr has no L1 quiz) and return null.
  assert.equal(computeUrls(8, 1).quiz, null);
  assert.equal(computeUrls(6, 1).quiz, null);
  assert.equal(
    computeUrls(7, 3).quiz,
    "https://robjohncolson.github.io/curriculum_render/?u=7&l=3"
  );
  assert.equal(
    computeUrls(1, 10).quiz,
    "https://robjohncolson.github.io/curriculum_render/?u=1&l=10"
  );
  assert.equal(computeUrls(1, 1).quiz, null);
});

test("cartridge lookup returns mapped units and null for unknown units", () => {
  assert.equal(getCartridgeId(8), "apstats-u8-unexpected-results");
  assert.equal(getCartridgeId(99), null);
});

test("quiz titles name each topic's own quiz", () => {
  assert.equal(computeQuizTitle(8, 1), null);
  assert.equal(computeQuizTitle(7, 3), "Quiz 7.3");
  assert.equal(computeQuizTitle(1, 1), null);
});

test("poster and heal share the same quiz title contract", () => {
  assert.equal(buildLinkTitles(8, 1).quiz, null);
  assert.equal(buildLinkTitles(7, 3).quiz, "Quiz 7.3");

  // A real (non-opener) lesson exposes its own quiz link.
  const expectedLinks = buildExpectedLinks(7, 3);
  const quizLink = expectedLinks.find((link) => link.key === "quiz");

  assert.ok(quizLink);
  assert.equal(quizLink.title, "Quiz 7.3");
  assert.match(quizLink.url, /\?u=7&l=3$/);

  // An opener (X.1) has no quiz of its own, so no quiz link is emitted.
  const openerLinks = buildExpectedLinks(8, 1);
  assert.equal(openerLinks.find((link) => link.key === "quiz"), undefined);
});

test("drills resolution exposes shared fallback behavior without external assumptions", () => {
  const unmapped = resolveDrillsLink(99, 1);
  assert.equal(unmapped.status, "no-cartridge");
  assert.equal(unmapped.url, null);
  assert.equal(unmapped.cartridgeId, null);

  const mapped = resolveDrillsLink(8, 1);
  assert.equal(mapped.cartridgeId, "apstats-u8-unexpected-results");
  assert.notEqual(mapped.url, null);
});
