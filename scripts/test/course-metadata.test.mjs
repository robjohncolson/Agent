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

test("computeUrls derives quiz URLs across unit boundaries", () => {
  assert.equal(
    computeUrls(8, 1).quiz,
    "https://robjohncolson.github.io/curriculum_render/?u=7&l=PC"
  );
  assert.equal(
    computeUrls(6, 1).quiz,
    "https://robjohncolson.github.io/curriculum_render/?u=5&l=PC"
  );
  assert.equal(
    computeUrls(7, 3).quiz,
    "https://robjohncolson.github.io/curriculum_render/?u=7&l=2"
  );
  assert.equal(computeUrls(1, 1).quiz, null);
});

test("cartridge lookup returns mapped units and null for unknown units", () => {
  assert.equal(getCartridgeId(8), "apstats-u8-unexpected-results");
  assert.equal(getCartridgeId(99), null);
});

test("quiz titles match the shared cross-unit rules", () => {
  assert.equal(computeQuizTitle(8, 1), "Unit 7 Progress Check");
  assert.equal(computeQuizTitle(7, 3), "Quiz 7.2");
  assert.equal(computeQuizTitle(1, 1), null);
});

test("poster and heal share the same quiz title contract", () => {
  assert.equal(buildLinkTitles(8, 1).quiz, "Unit 7 Progress Check");
  assert.equal(buildLinkTitles(7, 3).quiz, "Quiz 7.2");

  const expectedLinks = buildExpectedLinks(8, 1);
  const quizLink = expectedLinks.find((link) => link.key === "quiz");

  assert.ok(quizLink);
  assert.equal(quizLink.title, "Unit 7 Progress Check");
  assert.match(quizLink.url, /\?u=7&l=PC$/);
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
