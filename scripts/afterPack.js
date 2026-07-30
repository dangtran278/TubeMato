"use strict";
/**
 * afterPack hook:
 * 1. Strips non-English Chromium locale files.
 * 2. Embeds the icon + version metadata into the Windows exe.
 */
const path = require("path");
const fs = require("fs");
const { NtExecutable, NtExecutableResource, Data, Resource } = require("resedit");

/** en-US; the fallback when the exe carries no language of its own. */
const LANG_EN_US = 1033;
const CODEPAGE_UNICODE = 1200;

module.exports = async function afterPack(context) {
  // Strip all Chromium locales except en-US on every platform.
  const localesDir = path.join(context.appOutDir, "locales");
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (file !== "en-US.pak") {
        fs.rmSync(path.join(localesDir, file));
      }
    }
    console.log("  • stripped non-English locales");
  }

  if (context.electronPlatformName !== "win32") return;

  const appInfo = context.packager.appInfo;
  const projectDir = context.packager.projectDir;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.join(projectDir, "assets", "icons", "app.ico");

  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);

  const versionInfo = Resource.VersionInfo.fromEntries(res.entries)[0];
  if (versionInfo == null) {
    throw new Error(`No version info to edit in ${exePath}`);
  }
  const [translation = { lang: LANG_EN_US, codepage: CODEPAGE_UNICODE }] =
    versionInfo.getAllLanguagesForStringValues();

  // Replace Electron's existing icon group in place; appending a second group would leave
  // Explorer and the taskbar free to keep picking the old one.
  const iconGroup = Resource.IconGroupEntry.fromEntries(res.entries)[0];
  const icons = Data.IconFile.from(fs.readFileSync(iconPath)).icons.map((icon) => icon.data);
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    iconGroup?.id ?? 1,
    iconGroup?.lang ?? translation.lang,
    icons
  );

  versionInfo.setFileVersion(appInfo.buildVersion, translation.lang);
  versionInfo.setProductVersion(appInfo.buildVersion, translation.lang);
  versionInfo.setStringValues(translation, {
    ProductName: appInfo.productName,
    FileDescription: appInfo.productName,
    CompanyName: appInfo.companyName,
    LegalCopyright: `Copyright © ${new Date().getFullYear()} ${appInfo.companyName}`,
    FileVersion: appInfo.buildVersion,
    ProductVersion: appInfo.buildVersion,
  });
  versionInfo.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));

  console.log(`  • embedded icon + metadata  exe=${path.basename(exePath)}  icons=${icons.length}`);
};
