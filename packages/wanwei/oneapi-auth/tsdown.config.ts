import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-wanwei-oneapi-auth',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
