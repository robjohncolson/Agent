import {
  navigateToFolder,
  materialsUrl,
  resolveFolder,
  clickAddMaterials,
  clickAddFileLink,
  clickLinkOption,
  waitForPopup,
  fillLinkForm,
  submitPopup,
  sleep,
} from "./schoology-dom.mjs";

export async function cmdPostLink(page, courseId, { title, url, inFolder }) {
  if (inFolder == null || inFolder === "") {
    console.error("Error: inFolder is required.");
    return false;
  }

  let folderId;
  if (/^\d+$/.test(String(inFolder))) {
    folderId = String(inFolder);
  } else {
    const folder = await resolveFolder(page, courseId, inFolder);
    if (!folder?.id) {
      console.error(`Error: Could not resolve folder: ${inFolder}`);
      return false;
    }
    folderId = String(folder.id);
  }

  await navigateToFolder(page, courseId, folderId);
  const folderUrl = materialsUrl(courseId, folderId);

  await clickAddMaterials(page);
  await clickAddFileLink(page);
  await sleep(1500);
  await clickLinkOption(page);

  const popupReady = await waitForPopup(page);
  if (!popupReady) {
    console.error(`Error: Link popup did not appear for ${folderUrl}`);
    return false;
  }

  await sleep(1000);
  await fillLinkForm(page, { title, url });
  await submitPopup(page);

  if (!page.url().includes(folderId)) {
    await navigateToFolder(page, courseId, folderId);
  }

  console.log(`Posted: ${title}`);
  return true;
}
