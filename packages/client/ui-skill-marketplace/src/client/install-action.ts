/** Installation state reported by the desktop skill directory. */
export type MarketplaceInstallState = 'notInstalled' | 'installed' | 'updateAvailable' | 'conflict'

/** Native operation performed by one marketplace button press. */
export type MarketplaceInstallAction = 'install' | 'update' | 'uninstall'

/**
 * Resolve the single native operation represented by the marketplace button.
 * @param state - Current state reported for the marketplace package.
 * @returns The operation that completes the user's button action.
 */
export function marketplaceInstallAction(state: MarketplaceInstallState): MarketplaceInstallAction {
  if (state === 'updateAvailable') return 'update'
  if (state === 'installed') return 'uninstall'
  return 'install'
}
