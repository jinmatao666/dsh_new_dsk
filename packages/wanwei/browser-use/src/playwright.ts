import type { Context } from '@deepseek-ai/cordis'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/**
 * Mount the shipped Playwright MCP browser with the desktop's loopback proxy.
 * @param ctx - the session-lifecycle compatibility context.
 * @param proxyAddress - loopback HTTP proxy URL.
 * @param headless - whether to launch without a visible browser window.
 * @param executablePath - installed browser executable if found.
 */
export async function mountDesktopPlaywright(
  ctx: Context, proxyAddress: string, headless: boolean, executablePath?: string,
): Promise<void> {
  // Use the exact runtime and Playwright CLI shipped by the pinned provider.
  const provider = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp')
  const resolve = createRequire(provider)
  const cli = join(dirname(resolve.resolve('@playwright/mcp/package.json')), 'cli.js')
  const runtime = await import(pathToFileURL(resolve.resolve('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp')).href) as {
    mountSessionMcp(context: Context, options: {
      name: string
      exclusive: boolean
      command: string
      args: string[]
      env: Record<string, string>
    }): void
  }
  const args = [cli, '--browser', 'chromium', '--isolated', '--proxy-server', proxyAddress, '--proxy-bypass', '<-loopback>']
  if (headless) args.push('--headless')
  if (executablePath !== undefined) args.push('--executable-path', executablePath)
  const env = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_')).map(key => [key, '']))
  runtime.mountSessionMcp(ctx, { name: 'playwright-mcp', exclusive: false, command: process.execPath, args, env })
}
