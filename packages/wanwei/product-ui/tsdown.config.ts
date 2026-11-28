import { clientBundle } from '../../client/tsdown.client.ts'
import { previewRuntimePlugin } from './preview-runtime/build.mjs'
const configs = clientBundle('@deepseek-ai/dsh-wanwei-product-ui', ['lib/types/index.js', 'lib/types/invariant.js'])
export default ((options) => {
  const resolved = configs(options)
  for (const config of resolved) {
    if (config) config.plugins = [previewRuntimePlugin(), ...(config.plugins ?? [])]
  }
  return resolved
}) satisfies typeof configs
