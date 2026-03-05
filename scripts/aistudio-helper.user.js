// ==UserScript==
// @name         AI Studio Helper — AP Stats Lesson Prep
// @namespace    https://github.com/robjohncolson
// @version      1.0
// @description  Adds transcription + slide description prompt buttons to Google AI Studio
// @match        https://aistudio.google.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ── Prompt templates ────────────────────────────────────────────────

  const TRANSCRIBE_PROMPT = [
    'Transcribe this video with timestamps. Format each segment as:',
    '',
    '**[MM:SS]** <transcribed text>',
    '',
    'Include all spoken content. Be thorough and accurate.'
  ].join('\n');

  const DESCRIBE_SLIDES_PROMPT = [
    'Describe each slide or visual change in this video with timestamps. Format as:',
    '',
    '**[MM:SS]** — **Slide title or topic**',
    '<Description of what\'s shown: text, formulas, graphs, diagrams, examples, key definitions>',
    '',
    'Be thorough — capture all text on each slide, any formulas, graph labels, and visual details that a student would need to follow along.'
  ].join('\n');

  // ── DOM helpers ─────────────────────────────────────────────────────

  /**
   * Find the prompt input element on the page.
   * AI Studio may use a textarea, a contenteditable div, or a rich-text
   * editor wrapper.  We try several selectors in priority order.
   */
  function findPromptInput() {
    const selectors = [
      '.ql-editor',
      '[contenteditable="true"]',
      'textarea[aria-label*="prompt" i]',
      'textarea[aria-label*="Type" i]',
      'textarea[placeholder]',
      'textarea',
      '[role="textbox"]',
      '.text-input'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /**
   * Insert text into the prompt input and notify the framework so
   * the UI recognises the change.
   */
  function fillPrompt(text) {
    const el = findPromptInput();
    if (!el) {
      alert('AI Studio Helper: Could not find the prompt input on this page.');
      return;
    }

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Native form element
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ) || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      );
      if (nativeSetter && nativeSetter.set) {
        nativeSetter.set.call(el, text);
      } else {
        el.value = text;
      }
    } else {
      // contenteditable / rich-text editor
      el.innerText = text;
    }

    // Dispatch events so React / Angular / Lit picks up the change
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
  }

  /**
   * Extract the latest model response from the page.
   * We try several known selectors, then fall back to grabbing the last
   * large text block we can find.
   */
  function extractResponse() {
    const candidateSelectors = [
      '[data-test-id="response"]',
      '.response-container',
      '.model-response',
      'model-response',
      '.response-content',
      '.chat-response',
      '.markdown-content',
      'ms-chat-turn .turn-content',
      '.turn-content'
    ];

    for (const sel of candidateSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        const last = els[els.length - 1];
        const text = (last.innerText || last.textContent || '').trim();
        if (text.length > 20) return text;
      }
    }

    // Fallback: find the last sizeable text block in the conversation area
    const allBlocks = document.querySelectorAll(
      'div, section, article, pre, p'
    );
    let best = null;
    let bestLen = 0;
    for (const block of allBlocks) {
      const text = (block.innerText || '').trim();
      // Only consider blocks that look like real content
      if (text.length > 200 && text.length > bestLen) {
        // Ignore the toolbar itself
        if (block.closest('#aistudio-helper-toolbar')) continue;
        best = text;
        bestLen = text.length;
      }
    }

    return best;
  }

  /**
   * Trigger a text file download in the browser.
   */
  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ── Button actions ──────────────────────────────────────────────────

  function onTranscribe() {
    fillPrompt(TRANSCRIBE_PROMPT);
  }

  function onDescribeSlides() {
    fillPrompt(DESCRIBE_SLIDES_PROMPT);
  }

  function onSaveOutput() {
    const text = extractResponse();
    if (!text) {
      alert('AI Studio Helper: No model response found on the page.');
      return;
    }

    const filename = window.prompt(
      'Save response as:',
      'apstat_6-5-1_transcription.txt'
    );
    if (!filename) return; // user cancelled

    downloadTextFile(filename, text);
  }

  // ── Build the toolbar UI ────────────────────────────────────────────

  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'aistudio-helper-toolbar';

    toolbar.style.cssText = [
      'position: fixed',
      'bottom: 20px',
      'right: 20px',
      'z-index: 9999',
      'display: flex',
      'flex-direction: column',
      'gap: 6px',
      'padding: 10px',
      'background: rgba(30, 30, 30, 0.88)',
      'border-radius: 12px',
      'box-shadow: 0 4px 16px rgba(0,0,0,0.35)',
      'font-family: system-ui, -apple-system, sans-serif',
      'font-size: 13px',
      'backdrop-filter: blur(6px)',
      '-webkit-backdrop-filter: blur(6px)'
    ].join('; ');

    const buttons = [
      { label: '\uD83D\uDCDD Transcribe',       action: onTranscribe },
      { label: '\uD83D\uDDBC\uFE0F Describe Slides', action: onDescribeSlides },
      { label: '\uD83D\uDCBE Save Output',       action: onSaveOutput }
    ];

    buttons.forEach(function (def) {
      const btn = document.createElement('button');
      btn.textContent = def.label;
      btn.style.cssText = [
        'display: block',
        'width: 100%',
        'padding: 7px 14px',
        'border: 1px solid rgba(255,255,255,0.15)',
        'border-radius: 8px',
        'background: rgba(255,255,255,0.08)',
        'color: #e0e0e0',
        'cursor: pointer',
        'text-align: left',
        'font-size: 13px',
        'transition: background 0.15s'
      ].join('; ');

      btn.addEventListener('mouseenter', function () {
        btn.style.background = 'rgba(255,255,255,0.18)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.background = 'rgba(255,255,255,0.08)';
      });

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        def.action();
      });

      toolbar.appendChild(btn);
    });

    document.body.appendChild(toolbar);
  }

  // ── Initialise ──────────────────────────────────────────────────────

  // AI Studio is an SPA — the body may not be ready immediately.
  // Wait until the body exists, then inject the toolbar.
  function init() {
    if (document.body) {
      createToolbar();
    } else {
      const observer = new MutationObserver(function () {
        if (document.body) {
          observer.disconnect();
          createToolbar();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
