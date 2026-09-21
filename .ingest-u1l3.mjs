import { chromium } from "playwright";
import fs from "fs";

const UNIT = 1, LESSON = 3, VIDEONUM = 1;
const FILE_ID = "1ymcN0lS3-yU3fGxbAMPnyK4shPpkAVbZ";
const FILE_URL = `https://drive.google.com/file/d/${FILE_ID}/view`;
const OUT_DIR = "C:/Users/rober/Downloads/Projects/school/follow-alongs/u1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPTS = {
  transcription: `Transcribe this video with timestamps. Format each segment as:

**[MM:SS]** <transcribed text>

Include all spoken content. Be thorough and accurate.`,
  slides: `Describe each slide or visual change in this video with timestamps. Format as:

**[MM:SS]** — **Slide title or topic**
<Description of what's shown: text, formulas, graphs, diagrams, examples, key definitions>

Be thorough — capture all text on each slide, any formulas, graph labels, and visual details that a student would need to follow along.`,
};

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("aistudio.google.com")) || (await ctx.newPage());

// ---- attach ONCE; video stays attached for every subsequent turn ----
await page.goto("https://aistudio.google.com/prompts/new_chat", { waitUntil: "domcontentloaded" });
await sleep(4000);
await (await page.$('button[aria-label*="Insert images" i]')).click();
await sleep(1500);
await (await page.$('button:has-text("Drive"), [role="menuitem"]:has-text("Drive")')).click();
await sleep(6000);
const picker = page.frames().find((f) => f.url().includes("docs.google.com/picker"));
const search = await picker.waitForSelector('input[type="text"]', { timeout: 15000 });
await search.click();
await search.fill(FILE_URL);
await sleep(800);
await search.press("Enter");
await sleep(5000);
await (await picker.waitForSelector('[role="row"], div[data-id]', { timeout: 15000 })).click();
await sleep(1500);
await (await picker.$('button:has-text("Insert")')).click();
let ready = false;
for (let i = 0; i < 48; i++) {
  await sleep(5000);
  const tok = await page.evaluate(() => (document.body.innerText.match(/[\d,]+\s*tokens?/i) || [])[0] || "");
  if (tok) { console.log(`Video ready: ${tok}`); ready = true; break; }
}
if (!ready) { console.log("FATAL: video never reported a token count"); await browser.close(); process.exit(1); }

const ERR_RE = /forgot to attach|haven't attached|provide the video|an internal error|something went wrong|error has occurred|please try again/i;

// Submit a prompt in the current chat and wait for the NEW turn. Retries the
// SAME chat on transient errors (video remains attached — no re-attach needed).
async function runPrompt(promptText, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const turnsBefore = await page.evaluate(() => document.querySelectorAll("ms-chat-turn, .chat-turn").length);
    const input = await page.$('textarea[aria-label="Enter a prompt"], textarea, div[contenteditable="true"]');
    await page.evaluate(() => document.querySelectorAll(".cdk-overlay-backdrop").forEach((e) => e.remove()));
    await input.click();
    await sleep(500);
    await page.evaluate(async (t) => navigator.clipboard.writeText(t), promptText).catch(() => {});
    await page.keyboard.down("Control"); await page.keyboard.press("v"); await page.keyboard.up("Control");
    await sleep(1000);
    const typed = await input.evaluate((el) => el.value || el.innerText).catch(() => "");
    if (typed.length < 20) await input.fill(promptText);
    await page.keyboard.down("Control"); await page.keyboard.press("Enter"); await page.keyboard.up("Control");
    console.log(`  [${label}] submitted (attempt ${attempt}), waiting...`);

    const deadline = Date.now() + 600000;
    let verdict = null;
    while (Date.now() < deadline && !verdict) {
      await sleep(4000);
      const s = await page.evaluate(() => {
        const btn = document.querySelector("button.ctrl-enter-submits");
        const gen = btn && btn.innerText.includes("Stop");
        const turns = document.querySelectorAll("ms-chat-turn, .chat-turn");
        const last = turns[turns.length - 1];
        return { gen, n: turns.length, len: last ? last.innerText.length : 0, txt: last ? last.innerText : "" };
      });
      if (s.gen || s.n <= turnsBefore) continue;
      if (s.len > 800 && !ERR_RE.test(s.txt.slice(0, 200))) verdict = { ok: true, text: s.txt };
      else if (s.len > 0 && s.len < 800 && ERR_RE.test(s.txt)) verdict = { ok: false, why: s.txt.replace(/\s+/g, " ").slice(0, 90) };
    }
    if (verdict && verdict.ok) return verdict.text;
    console.log(`  [${label}] ${verdict ? "error: " + verdict.why : "timed out"} — re-running prompt in same chat`);
    await sleep(8000);
  }
  return null;
}

for (const [key, prompt] of Object.entries(PROMPTS)) {
  const text = await runPrompt(prompt, key);
  if (!text) { console.log(`FATAL: ${key} exhausted retries`); await browser.close(); process.exit(1); }
  const suffixLabel = key === "transcription" ? "Transcript" : "Slide Descriptions";
  const header = `# Video ${VIDEONUM} — ${suffixLabel}\n# Unit ${UNIT}, Lesson ${LESSON}\n\n`;
  const file = `${OUT_DIR}/apstat_${UNIT}-${LESSON}-${VIDEONUM}_${key}.txt`;
  fs.writeFileSync(file, header + text.trim() + "\n");
  console.log(`[${key}] SAVED ${file} (${text.trim().length} chars)`);
}
await browser.close().catch(() => {});
console.log("DONE — both files written");
