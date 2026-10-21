/** Host-owned discovery policy shared by filesystem providers in agent presets. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Deployment overrides applied to every local skill discovery provider. */
export interface Config {
  /** Whether implicit project roots use the lookup cwd or its Git ancestor. */
  projectRootMode: 'git' | 'cwd'
  /** Whether implicit roots may include the shared user agents directory. */
  includeUserAgentsRoot: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment-wide filesystem discovery policy, absent in generic profiles. */
    skillFileSystemPolicy: SkillFileSystemPolicy
  }
}

/** A deployment policy applies to host and preset providers without editing presets. */
export class SkillFileSystemPolicy extends Service {
  static Config = z.object({
    projectRootMode: z.union(['git', 'cwd'] as const).required(),
    includeUserAgentsRoot: z.boolean().required(),
  })

  /**
   * @param ctx - host context owning this deployment policy.
   * @param config - root-discovery rules shared by all descendant providers.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'skillFileSystemPolicy')
  }
}

export default SkillFileSystemPolicy
