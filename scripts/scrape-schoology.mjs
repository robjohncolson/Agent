#!/usr/bin/env node
// Recursive Schoology materials scraper
// Connects via CDP, navigates every folder, extracts full material tree
// Output: state/schoology-materials.json

import pw from 'playwright';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'state', 'schoology-materials.json');

const COURSE_ID = '7945275782';
const BASE = `https://lynnschools.schoology.com/course/${COURSE_ID}/materials`;

// Rate limiting — be gentle with the school's server
const NAV_DELAY = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrapeFolderContents(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#folder-contents-table tr')];
    const folders = [];
    const materials = [];

    for (const tr of rows) {
      const id = tr.id;
      if (!id || id.startsWith('materials-row-add')) continue;

      if (id.startsWith('f-')) {
        // --- Folder row ---
        const folderId = id.slice(2);
        const titleEl = tr.querySelector('.folder-title a');
        const descEl = tr.querySelector('.s-js-folder-description, .folder-description');
        folders.push({
          type: 'folder',
          id: folderId,
          schoologyId: folderId,
          title: titleEl?.innerText?.trim() || '',
          href: titleEl?.href || '',
          description: descEl?.innerText?.trim() || '',
          displayWeight: tr.getAttribute('display_weight') || '',
          children: [] // filled by recursion
        });
      } else if (id.startsWith('n-')) {
        // --- Material row ---
        const nodeId = id.slice(2);
        const cls = tr.className;

        // Determine material type from class
        let materialType = 'unknown';
        if (cls.includes('type-document')) materialType = 'document';
        if (cls.includes('type-discussion')) materialType = 'discussion';
        if (cls.includes('type-assignment')) materialType = 'assignment';
        if (cls.includes('type-assessment')) materialType = 'assessment';
        if (cls.includes('type-page')) materialType = 'page';

        // Get title — different location for links vs discussions
        let title = '';
        let href = '';

        // Try gen-post-link first (web links)
        const linkEl = tr.querySelector('a.gen-post-link');
        if (linkEl) {
          title = linkEl.innerText?.trim() || linkEl.getAttribute('title') || '';
          href = linkEl.href || '';
        }

        // Fallback to .item-title a (discussions, assignments)
        if (!title) {
          const titleA = tr.querySelector('.item-title a');
          if (titleA) {
            title = titleA.innerText?.trim() || '';
            href = titleA.href || '';
          }
        }

        // Detect sub-type from icon
        const iconEl = tr.querySelector('.inline-icon, .item-icon');
        const iconCls = iconEl?.className || '';
        let subType = '';
        if (iconCls.includes('link-icon')) subType = 'link';
        else if (iconCls.includes('discussion-icon')) subType = 'discussion';
        else if (iconCls.includes('assignment-icon')) subType = 'assignment';
        else if (iconCls.includes('file-icon')) subType = 'file';
        else if (iconCls.includes('page-icon')) subType = 'page';

        // Get body/description text
        const bodyEl = tr.querySelector('.item-body');
        const bodyText = bodyEl?.innerText?.trim() || '';

        materials.push({
          type: 'material',
          materialType: subType || materialType,
          id: nodeId,
          schoologyId: nodeId,
          title,
          href,
          bodyText: bodyText.slice(0, 500),
          displayWeight: tr.getAttribute('display_weight') || ''
        });
      }
    }

    return { folders, materials };
  });
}

async function scrapeFolder(page, folderId, depth, path) {
  const indent = '  '.repeat(depth);
  const url = folderId
    ? `${BASE}?f=${folderId}`
    : BASE;

  console.log(`${indent}→ Navigating to ${folderId ? 'folder ' + folderId : 'course root'}...`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for the materials table to render
  await page.waitForSelector('#folder-contents-table', { timeout: 15000 }).catch(() => {
    console.log(`${indent}  ⚠ No #folder-contents-table found, might be empty folder`);
  });
  await sleep(NAV_DELAY);

  const { folders, materials } = await scrapeFolderContents(page);

  console.log(`${indent}  Found ${folders.length} folders, ${materials.length} materials`);
  for (const m of materials) {
    console.log(`${indent}    📄 ${m.title} (${m.materialType})`);
  }

  // Recurse into each sub-folder
  for (const folder of folders) {
    console.log(`${indent}  📁 ${folder.title}`);
    const childPath = [...path, folder.title];
    folder.path = childPath;
    folder.children = await scrapeFolder(page, folder.id, depth + 1, childPath);
  }

  // Return combined: folders (with children) + materials
  return [...folders, ...materials];
}

async function main() {
  console.log('Connecting to Edge CDP on port 9222...');
  const browser = await pw.chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();

  // Use the existing Schoology tab or create one
  let page = pages.find(p => p.url().includes('schoology'));
  if (!page) {
    page = await ctx.newPage();
  }

  console.log(`Starting full recursive scrape of course ${COURSE_ID}\n`);

  const startTime = Date.now();
  const tree = await scrapeFolder(page, null, 0, []);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Build summary stats
  let totalFolders = 0, totalMaterials = 0;
  function countItems(items) {
    for (const item of items) {
      if (item.type === 'folder') {
        totalFolders++;
        if (item.children) countItems(item.children);
      } else {
        totalMaterials++;
      }
    }
  }
  countItems(tree);

  const output = {
    courseId: COURSE_ID,
    courseUrl: BASE,
    scrapedAt: new Date().toISOString(),
    elapsedSeconds: parseFloat(elapsed),
    stats: { totalFolders, totalMaterials },
    tree
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✓ Done in ${elapsed}s — ${totalFolders} folders, ${totalMaterials} materials`);
  console.log(`  Saved to ${OUTPUT}`);

  await browser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
