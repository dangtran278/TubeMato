'use strict'
/**
 * afterPack hook — runs rcedit on the Windows exe with absolute paths.
 * Bypasses electron-builder's broken relative-path icon resolution in v26.
 */
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const appInfo = context.packager.appInfo
  const projectDir = context.packager.projectDir
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`)
  const iconPath = path.join(projectDir, 'assets', 'icons', 'app.ico')
  const appBuilder = require('app-builder-bin').appBuilderPath

  const args = [
    exePath,
    '--set-icon', iconPath,
    '--set-version-string', 'ProductName',    appInfo.productName,
    '--set-version-string', 'FileDescription', appInfo.productName,
    '--set-version-string', 'CompanyName',    appInfo.productName,
    '--set-version-string', 'LegalCopyright', `Copyright \u00A9 ${new Date().getFullYear()} ${appInfo.productName}`,
    '--set-file-version',    appInfo.buildVersion,
    '--set-product-version', appInfo.buildVersion,
  ]

  execFileSync(appBuilder, ['rcedit', '--args', JSON.stringify(args)], {
    windowsHide: true,
    stdio: 'pipe',
  })

  console.log(`  • embedded icon + metadata  exe=${path.basename(exePath)}`)
}
