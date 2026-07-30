"use strict";
/**
 * afterPack hook:
 * 1. Strips non-English Chromium locale files.
 * 2. Runs rcedit on the Windows exe to embed icon + version metadata.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

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
  const appBuilder = require("app-builder-bin").appBuilderPath;

  const args = [
    exePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "ProductName",
    appInfo.productName,
    "--set-version-string",
    "FileDescription",
    appInfo.productName,
    "--set-version-string",
    "CompanyName",
    appInfo.companyName,
    "--set-version-string",
    "LegalCopyright",
    `Copyright \u00A9 ${new Date().getFullYear()} ${appInfo.companyName}`,
    "--set-file-version",
    appInfo.buildVersion,
    "--set-product-version",
    appInfo.buildVersion,
  ];

  execFileSync(appBuilder, ["rcedit", "--args", JSON.stringify(args)], {
    windowsHide: true,
    stdio: "pipe",
  });

  console.log(`  • embedded icon + metadata  exe=${path.basename(exePath)}`);
};
