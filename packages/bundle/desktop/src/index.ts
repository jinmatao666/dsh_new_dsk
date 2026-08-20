/**
 * DSH Desktop profile overlay. Runtime behavior is contributed entirely by
 * plugins listed in `cordis.patch.yml`; this module anchors bundle metadata.
 * @module @deepseek-ai/dsh-desktop
 */

/** Stable Cordis plugin name when the bundle root is inspected directly. */
export const name = 'desktop-bundle'

/** The bundle root intentionally mounts no runtime service. */
export function apply(): void {}
