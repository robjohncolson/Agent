/**
 * verify-ti84-cemu.mjs — Capture CEmu screenshots for TI-84 CE procedure verification
 *
 * Launches CEmu with the TI-84 Plus CE ROM, sends key sequences for each
 * AP Stats procedure, and captures screenshots after each step.
 *
 * Screenshots are saved to: follow-alongs/ti84-cemu-screenshots/
 * Claude Code reads these images for visual verification.
 *
 * Usage:  node scripts/verify-ti84-cemu.mjs [--procedure <id>]
 * Requires: CEmu installed via winget, PowerShell for SendKeys/screenshot
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CEMU_EXE = "C:/Users/rober/AppData/Local/Microsoft/WinGet/Links/CEmu.exe";
const ROM_PATH = "C:/Users/rober/Downloads/Projects/school/follow-alongs/TI-84_Plus_CE/ROM.rom";
const SCREENSHOT_DIR = "C:/Users/rober/Downloads/Projects/school/follow-alongs/ti84-cemu-screenshots";
const PROCEDURES_JSON = "C:/Users/rober/Downloads/Projects/school/follow-alongs/ti84-procedures-data.json";

// CEmu default key mappings (from keymap.cpp source)
// Maps TI-84 key names to Windows virtual key names for SendKeys
const KEY_MAP = {
  // Top row (graph keys) — F1-F5
  "Y_EQUALS": "F1",   // Y=
  "Y=": "F1",
  "WINDOW": "F2",
  "ZOOM": "F3",
  "TRACE": "F4",
  "GRAPH": "F5",

  // Row 2
  "2ND": "F6",         // 2nd
  "MODE": "F7",
  "DEL": "F8",

  // Row 3
  "ALPHA": "F9",
  "X_T_THETA_N": "F10",
  "STAT": "{END}",     // STAT = End key

  // Arrow keys
  "UP": "{UP}",
  "DOWN": "{DOWN}",
  "LEFT": "{LEFT}",
  "RIGHT": "{RIGHT}",

  // Row 4
  "MATH": "A",         // CEmu maps MATH to 'A'
  "APPS": "B",
  "PRGM": "C",
  "VARS": "D",         // Also used for 2ND>DISTR

  // Clear
  "CLEAR": "{DELETE}",

  // Row 5
  "X_INVERSE": "E",    // x⁻¹
  "SIN": "F",
  "COS": "G",
  "TAN": "H",
  "POWER": "I",        // ^

  // Row 6
  "X_SQUARED": "J",    // x²
  "COMMA": "K",        // ,
  "LEFT_PAREN": "L",   // (
  "RIGHT_PAREN": "M",  // )
  "DIVIDE": "N",       // ÷

  // Row 7
  "LOG": "O",
  "7": "7",
  "8": "8",
  "9": "9",
  "MULTIPLY": "P",     // ×

  // Row 8
  "LN": "Q",
  "4": "4",
  "5": "5",
  "6": "6",
  "SUBTRACT": "R",     // −

  // Row 9
  "STO": "S",          // STO→
  "1": "1",
  "2": "2",
  "3": "3",
  "ADD": "T",          // +

  // Row 10
  "ON": "U",
  "0": "0",
  "POINT": "V",        // .
  "NEGATIVE": "W",     // (−)
  "ENTER": "{ENTER}",
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Send a key to the CEmu window via PowerShell
 */
function sendKey(keyName) {
  const mapped = KEY_MAP[keyName];
  if (!mapped) {
    console.error(`  !! Unknown key: ${keyName}`);
    return false;
  }

  // PowerShell SendKeys
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$wsh = New-Object -ComObject WScript.Shell
$wsh.AppActivate('CEmu') | Out-Null
Start-Sleep -Milliseconds 200
$wsh.SendKeys('${mapped.replace(/'/g, "''")}')
`;
  try {
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch (err) {
    console.error(`  !! SendKey failed for ${keyName}: ${err.message}`);
    return false;
  }
}

/**
 * Capture a screenshot of the CEmu window via PowerShell
 */
function captureScreenshot(filename) {
  const outPath = join(SCREENSHOT_DIR, filename);
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Find CEmu window
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

# Find window by partial title
$procs = Get-Process -Name "CEmu" -ErrorAction SilentlyContinue
if (-not $procs) { Write-Error "CEmu not running"; exit 1 }

$hwnd = $procs[0].MainWindowHandle
if ($hwnd -eq 0) { Write-Error "No CEmu window found"; exit 1 }

[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 100

$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$g.Dispose()

$bmp.Save('${outPath.replace(/\\/g, "\\\\").replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Saved: ${filename}"
`;
  try {
    const result = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, {
      timeout: 10000,
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log(`  📸 ${result.trim()}`);
    return outPath;
  } catch (err) {
    console.error(`  !! Screenshot failed: ${err.message}`);
    return null;
  }
}

/**
 * Run a procedure: send each key, capture screenshot after each step
 */
async function runProcedure(proc) {
  console.log(`\n=== ${proc.id} (${proc.steps.length} steps) ===`);

  // First, go home: press CLEAR twice, then 2ND+MODE (QUIT)
  sendKey("CLEAR");
  await sleep(300);
  sendKey("CLEAR");
  await sleep(300);
  sendKey("2ND");
  await sleep(200);
  sendKey("MODE"); // 2ND+MODE = QUIT
  await sleep(500);

  // Capture home screen
  captureScreenshot(`${proc.id}_00_home.png`);
  await sleep(300);

  for (let i = 0; i < proc.steps.length; i++) {
    const step = proc.steps[i];
    const stepNum = String(i + 1).padStart(2, "0");
    let key = step.key;

    // Handle special keys
    if (key.startsWith("{") || key === "ENTER") {
      // literal
    } else if (key.length === 1 && /[0-9]/.test(key)) {
      // number key — already in map
    }

    // Some procedures use composite keys (e.g., "2ND" then "VARS" for DISTR)
    // We handle those as sequential steps — the JSON should have them as separate steps

    console.log(`  Step ${stepNum}: press [${key}] → ${step.screen || "?"}`);
    const sent = sendKey(key);
    if (!sent) {
      console.log(`  ⚠️ Skipping screenshot for failed key`);
      continue;
    }

    await sleep(600); // wait for screen to update
    captureScreenshot(`${proc.id}_${stepNum}_${step.screen || "unknown"}.png`);
    await sleep(200);
  }

  console.log(`  ✅ ${proc.id} complete`);
}

// ── Main ────────────────────────────────────────────────────────────────────

// Parse args
const targetProc = process.argv.includes("--procedure")
  ? process.argv[process.argv.indexOf("--procedure") + 1]
  : null;

// Create screenshot directory
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Load procedures
const data = JSON.parse(readFileSync(PROCEDURES_JSON, "utf8"));

// Priority order for verification
const priorityOrder = [
  // HIGH: inference tests
  "one-propztest", "one-propzint",
  "t-test-stats", "t-test-data",
  "t-interval-stats", "t-interval-data",
  "two-samp-ttest", "two-samp-tint",
  "chi-square-test", "chi-square-gof-test",
  "linreg-ttest", "linreg-tint",
  // MEDIUM: distributions
  "normalcdf", "invnorm",
  "binompdf", "binomcdf",
  "geometpdf", "geometcdf",
  // LOWER: descriptive
  "one-var-stats", "linreg-a-plus-bx",
];

const procedures = targetProc
  ? data.procedures.filter(p => p.id === targetProc)
  : data.procedures
      .filter(p => priorityOrder.includes(p.id))
      .sort((a, b) => priorityOrder.indexOf(a.id) - priorityOrder.indexOf(b.id));

if (procedures.length === 0) {
  console.error("No matching procedures found.");
  process.exit(1);
}

console.log(`Verifying ${procedures.length} procedures.`);
console.log(`Screenshots → ${SCREENSHOT_DIR}`);
console.log(`CEmu exe: ${CEMU_EXE}`);

// Check if CEmu is already running
try {
  execSync('tasklist | grep -i cemu', { encoding: "utf-8", stdio: "pipe" });
  console.log("CEmu is already running.");
} catch {
  console.log("Launching CEmu...");
  const child = spawn(CEMU_EXE, [ROM_PATH], { detached: true, stdio: "ignore" });
  child.unref();
  console.log("Waiting for CEmu to boot...");
  await sleep(8000);
}

// Run procedures
for (const proc of procedures) {
  await runProcedure(proc);
}

console.log("\n=== All procedures captured ===");
console.log(`Screenshots in: ${SCREENSHOT_DIR}`);
console.log("Use Claude Code's Read tool to view each screenshot for verification.");
