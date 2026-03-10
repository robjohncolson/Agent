import {
  VALID_COLORS,
  clickAddFolder,
  clickAddMaterials,
  fillFolderForm,
  listItems,
  navigateToFolder,
  resolveFolder,
  sleep,
  submitPopup,
  waitForPopup
} from "./schoology-dom.mjs";

export async function cmdCreateFolder(page, courseId, { name, inFolder = null, color = null }) {
  let targetFolderId = null;

  if (inFolder != null) {
    const ref = String(inFolder);
    const resolved = /^\d+$/.test(ref)
      ? { id: ref, name: ref }
      : await resolveFolder(page, courseId, ref);

    if (!resolved?.id) {
      console.error(`  Could not resolve target folder: "${inFolder}"`);
      return null;
    }

    targetFolderId = resolved.id;
    await navigateToFolder(page, courseId, targetFolderId);
  } else {
    await navigateToFolder(page, courseId);
  }

  const beforeItems = await listItems(page);
  const existing = beforeItems.find(item => item.type === "folder" && item.name === name);
  if (existing) {
    console.log(`  Folder already exists: "${name}" (ID: ${existing.id})`);
    return existing;
  }

  let folderColor = "blue";
  if (typeof color === "string" && color.trim()) {
    const normalized = color.trim().toLowerCase();
    if (VALID_COLORS.includes(normalized)) {
      folderColor = normalized;
    } else {
      console.warn(`  Invalid folder color "${color}", defaulting to "blue"`);
    }
  }

  await clickAddMaterials(page);
  await sleep(1500);
  await clickAddFolder(page);

  const popupLoaded = await waitForPopup(page);
  if (!popupLoaded) {
    console.error('  Folder creation popup did not appear');
    return null;
  }

  await fillFolderForm(page, { name, color: folderColor });
  await submitPopup(page);

  const afterItems = await listItems(page);
  const created = afterItems.find(item => item.type === "folder" && item.name === name);
  if (created) {
    console.log(`  Created folder: "${name}" (ID: ${created.id})`);
    return created;
  }

  console.warn(`  Warning: could not verify folder creation for "${name}"`);
  const folders = afterItems.filter(item => item.type === "folder");
  if (folders.length === 0) {
    console.warn("  No folders found at this level");
    return null;
  }

  for (const folder of folders) {
    console.warn(`  ${folder.id}: ${folder.name}`);
  }
  return null;
}
