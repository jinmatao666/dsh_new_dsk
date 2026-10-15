import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'

/** Register verified, replacement-style final file delivery on the normal tool-result log.
 * @param ctx - Host plugin context; registration follows its lifecycle.
 */
export function installFinalDeliverables(ctx: Context): void {
  ctx.inject(['tools', 'fs', 'systemPrompt'], (child) => {
    child.systemPrompt.section({
      name: 'wanwei:final-deliverables',
      order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES,
      text: 'When a task produces files, call deliver_files with the COMPLETE final delivery list before your final reply. '
        + 'Exclude scratch files, conversion inputs, previews, helper scripts and intermediate documents unless the user requested them as outputs. '
        + 'The tool verifies existing files and replaces any earlier delivery list for this turn. Do not claim delivery if it fails. '
        + 'This tool declares files only; an empty list does not mean the task has no answer. '
        + 'For tasks without output files, you may omit the call or declare an empty list. '
        + 'Complete any file declaration before the final reply, then give the full requested answer, including text-only results. '
        + 'Do not replace the answer with a file-list acknowledgement or list processing files.',
    })
    child.tools.register(defineTool({
      name: 'deliver_files',
      description: 'Verify and declare the complete final file delivery list. Replaces the earlier list for this turn; excludes processing files.',
      parameters: {
        paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Final output paths. Relative paths use the current workspace. Empty clears the earlier list.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          files: { type: 'array', required: true, items: { type: 'string' } },
        } },
        render: (_args, value) => [{ type: 'text', text: `DSH_DELIVERABLES=${JSON.stringify(value.files)}` }],
      },
      async execute(args: { paths: string[] }, exec) {
        if (exec.agent === undefined) throw new Error('deliver_files requires an owning agent session')
        if (args.paths.length > 128) throw new Error('At most 128 final files may be delivered in one call')
        const files: string[] = []
        const seen = new Set<string>()
        for (const path of args.paths) {
          if (path.trim() === '') throw new Error('Final file paths must not be blank')
          const cwd = exec.agent.session.header.cwd
          const target = await child.fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal })
          const info = await child.fs.stat(target, exec.signal)
          if (info?.type !== 'file') throw new Error(`Final file does not exist or is not a regular file: ${path}`)
          if (!seen.has(target.targetKey)) {
            seen.add(target.targetKey)
            files.push(child.fs.processPath(target))
          }
        }
        return { files }
      },
      presentCall: args => ({ card: 'generic', title: 'Deliver final files', kind: 'other', rawInput: args.paths }),
    }))
  })
}
