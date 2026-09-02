/**
 * Model-facing full-file write. It preflights the target for a safe existing-file decision,
 * obtains an optional intent from the single policy slot, then records the resulting version;
 * no policy means an unconditional atomic create-or-overwrite.
 * @module @deepseek-ai/dsh-tool-fs/src/write
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-questions'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'

/**
 * Validate value constraints the schema DSL can't express: only a non-blank
 * `file_path` — an empty `content` is legitimate (it writes an empty file).
 * @param args - the schema-validated raw tool arguments.
 * @returns the camelCased input; `content` passes through untouched.
 */
export function parseWriteArgs(args: { file_path: string; content: string }): { filePath: string; content: string } {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  return { filePath: args.file_path, content: args.content }
}

/**
 * Format a write outcome as one model-facing text block body.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param outcome - the write outcome; its `operation` selects the Created/Updated wording.
 * @returns the model-facing confirmation envelope (no file content is echoed back).
 */
export function formatWriteOutput(displayPath: string, outcome: Pick<FsWriteOutcome, 'operation'>): string {
  const verb = outcome.operation === 'create' ? 'Created' : 'Updated'
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${verb} file
</content>`
}

const CREATE_VERSION_LABEL = '创建新版本'
const OVERWRITE_LABEL = '覆盖已有文件'
const CANCEL_LABEL = '取消'

/**
 * Produce a sibling name that preserves the requested extension.
 * @param requestedPath - The model-requested output path.
 * @param sequence - The new-file sequence, beginning at two.
 * @returns A path such as `report (2).docx`.
 */
function versionedPath(requestedPath: string, sequence: number): string {
  const separator = Math.max(requestedPath.lastIndexOf('/'), requestedPath.lastIndexOf('\\'))
  const directory = requestedPath.slice(0, separator + 1)
  const basename = requestedPath.slice(separator + 1)
  const extensionAt = basename.lastIndexOf('.')
  const hasExtension = extensionAt > 0
  const stem = hasExtension ? basename.slice(0, extensionAt) : basename
  const extension = hasExtension ? basename.slice(extensionAt) : ''
  return `${directory}${stem} (${sequence})${extension}`
}

/**
 * The `write` tool's validated arguments: the base parameters plus the
 * two escalation fields, advertised only under a confining `ctx.fs` (absent
 * from the schema otherwise, so the validator rejects them before `execute`).
 */
interface WriteToolArgs {
  file_path: string
  content: string
  sandbox_permissions?: string
  justification?: string
}

/**
 * Register the `write` tool and its system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyWriteTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:write',
    order: 101,
    text: 'Use the write tool to create files or completely replace file contents. The tool handles an existing output path before writing: workspace-write mode asks the user whether to create a new version, overwrite, or cancel; full access reads then overwrites. Prefer edit for targeted changes.',
  })

  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to write, resolved by the filesystem backend.' },
      content: { type: 'string', required: true, description: 'Full UTF-8 text content to write.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          before: {
            required: true,
            oneOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatWriteOutput(value.path, value) }],
      presentationMeta: (args, value) => ({
        diffs: value.before === null
          ? []
          : computeHunkDiffs(args.file_path, value.before, value.after)
            .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: WriteToolArgs, exec) {
      const input = parseWriteArgs(args)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes;
      // an escalating call throws its distinct text on any non-grant.
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      let requestedPath = input.filePath
      let target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath, sandboxPolicy?.workspaceRoot))
      let existing
      try {
        existing = await ctx.fs.stat(target, exec.signal)
      } catch (error: unknown) {
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy))
      }

      if (existing === undefined) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
      } else if (existing.type === 'file') {
        if (sandboxPolicy?.mode === 'workspace-write') {
          const userQuestions = ctx.get('userQuestions')
          if (userQuestions === undefined) {
            throw new Error('该文件已存在，但当前环境无法询问用户应创建新版本、覆盖还是取消写入。')
          }
          const answer = await userQuestions.ask({
            signal: exec.signal,
            ...exec.agent !== undefined ? { agent: exec.agent } : {},
            questions: [{
              id: 'existing-output',
              header: '文件已存在',
              question: `“${target.displayPath}”已存在。请选择处理方式。`,
              detail: '创建新版本会保留原文件；覆盖会先读取现有文件后再替换内容。',
              options: [
                { label: CREATE_VERSION_LABEL, description: '保留原文件，并以新的序号创建输出文件。' },
                { label: OVERWRITE_LABEL, description: '读取并替换已有文件的完整内容。' },
                { label: CANCEL_LABEL, description: '不写入任何文件。' },
              ],
            }],
          })
          const choice = answer.answers.find(item => item.id === 'existing-output')?.selected[0]
          if (choice === CANCEL_LABEL || choice === undefined) {
            throw new Error('用户取消了对现有文件的写入。')
          }
          if (choice === CREATE_VERSION_LABEL) {
            let sequence = 2
            do {
              requestedPath = versionedPath(input.filePath, sequence++)
              target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath, sandboxPolicy.workspaceRoot))
              existing = await ctx.fs.stat(target, exec.signal)
            } while (existing !== undefined)
            ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
          } else if (choice === OVERWRITE_LABEL) {
            await ctx.fs.readText(target, exec.signal)
            ctx.emit('fs/observed', target, { kind: 'present', version: existing.version }, exec)
          } else {
            throw new Error('用户给出了无法识别的文件写入选择。')
          }
        } else {
          // Full access does not interrupt the task just because an output name
          // exists. Read first so the observation policy can safely authorize
          // the replacement.
          await ctx.fs.readText(target, exec.signal)
          ctx.emit('fs/observed', target, { kind: 'present', version: existing.version }, exec)
        }
      }

      // Single-slot decision: the policy plugin produces createIfAbsent/
      // replaceIfVersion from the authoritative preflight observation; the
      // bare default is undefined (unconditional).
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      let outcome: FsWriteOutcome
      try {
        outcome = await ctx.fs.writeText(target, input.content, intent, exec.signal, sandboxPolicy)
      } catch (error: unknown) {
        // A sandbox denial becomes the shared [sandbox: …] marker (the model
        // recognizes it from bash); stale/not-observed failures gain their
        // model-facing remedy; anything else passes through.
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy))
      }
      // Record the present observation (a no-op when no policy plugin listens).
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        operation: outcome.operation,
        before: outcome.before,
        after: outcome.after,
      }
    },
    // Pure display: a diff card. A call-time presenter has no access to prior
    // file content, so `oldText: null` also represents an overwrite here.
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Write ${args.file_path}`,
        diffs: [{ path: args.file_path, oldText: null, newText: args.content }],
        locations: [{ path: args.file_path }],
      }
    },
    // Result-time display repeats the diff because completed views replace the
    // pending view. Overwrites use applied metadata; creates and identical
    // overwrites use the replay-safe args fallback.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
        ?? [{ path: args.file_path, oldText: null, newText: args.content }]
      return { card: 'diff', title: `Write ${args.file_path}`, diffs }
    },
  }))
}
