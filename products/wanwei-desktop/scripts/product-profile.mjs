import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PRODUCT_PROFILE = 'wanwei-desktop'
export const PRODUCT_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-wanwei-desktop',
]

/** Create only missing product-owned profile files; never replace user configuration. */
export function ensureProductProfile(dshHome) {
  const directory = join(dshHome, 'profiles', PRODUCT_PROFILE)
  mkdirSync(directory, { recursive: true })
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, `${JSON.stringify({
      name: `dsh-profile-${PRODUCT_PROFILE}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: PRODUCT_BUNDLES, patchReload: 'live' } },
    }, null, 2)}\n`)
  }
  const patchPath = join(directory, 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    writeFileSync(patchPath, '# Product user overrides are applied after the desktop bundle.\n[]\n')
  }
  const workspacePath = join(directory, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) {
    writeFileSync(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  }
}
