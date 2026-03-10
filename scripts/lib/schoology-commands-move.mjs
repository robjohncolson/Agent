import {
  navigateToFolder,
  listItems,
  resolveFolder,
  openGearMenu,
  clickMoveOption,
  waitForPopup,
  selectMoveTarget,
  getMoveOptions,
  submitMovePopup,
  sleep,
} from "./schoology-dom.mjs";

export async function cmdMoveFolder(page, courseId, { name, into, from = null }) {
  // Navigate to the parent folder where the source lives
  if (from != null) {
    const ref = String(from);
    if (/^\d+$/.test(ref)) {
      await navigateToFolder(page, courseId, ref);
    } else {
      const resolved = await resolveFolder(page, courseId, ref);
      if (!resolved?.id) {
        console.error(`  Could not resolve source parent folder: "${from}"`);
        return false;
      }
      await navigateToFolder(page, courseId, resolved.id);
    }
  } else {
    await navigateToFolder(page, courseId);
  }

  // Find the source folder by name
  const items = await listItems(page);
  const source = items.find(i => i.type === "folder" && i.name === name);

  if (!source) {
    console.error(`  Could not find folder: "${name}"`);
    console.error("  Available folders:");
    items.filter(i => i.type === "folder").forEach(f => console.error(`    [${f.id}] ${f.name}`));
    return false;
  }

  const rowId = `f-${source.id}`;
  console.log(`  Found folder "${name}" (${rowId})`);

  // Open gear menu and click Move
  await openGearMenu(page, rowId);
  await sleep(1000);
  await clickMoveOption(page, rowId);

  // Wait for move popup
  const popupLoaded = await waitForPopup(page);
  if (!popupLoaded) {
    console.error("  Move popup did not appear");
    return false;
  }
  await sleep(1500);

  // Select target in dropdown
  const selected = await selectMoveTarget(page, into);
  if (!selected.found) {
    console.error(`  Could not find target "${into}" in move dropdown`);
    const options = await getMoveOptions(page);
    console.error("  Available options:");
    options.forEach(o => console.error(`    ${o.text}`));
    return false;
  }

  console.log(`  Selected target: "${selected.text}"`);

  // Submit
  await submitMovePopup(page);
  console.log(`  Moved "${name}" into "${into}"`);
  return true;
}
