import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Register verified, replacement-style final file delivery on the normal tool-result log.
 * @param ctx - Host plugin context; registration follows its lifecycle.
 */
export function installFinalDeliverables(ctx: Context): void {
  ctx.inject(['tools', 'fs', 'systemPrompt'], (child) => {
    const reminded = new WeakMap<object, number>()
    child.on('agent/turn-stopping', ({ agent, turn, signal }) => {
      if (signal.aborted || reminded.get(agent.session) === turn) return
      const calls = new Map<string, string>()
      let lastWork = -1
      let lastDeclaration = -1
      for (const event of agent.session.events) {
        if (event.type === 'tool/call' && event.data.turn === turn) calls.set(String(event.data.callId), event.data.name)
        if (event.type !== 'tool/result' || event.data.turn !== turn) continue
        const result = event.data.message.content[0]
        const name = calls.get(String(event.data.message.source.callId))
        if (result.isError === true) {
          if (name === 'deliver_files') lastDeclaration = -1
          continue
        }
        if (name === 'deliver_files') lastDeclaration = event.seq
        if (name !== undefined && [
          'write', 'edit', 'str_replace_editor', 'bash', 'pwsh', 'exec_command', 'run_code', 'terminal_send',
        ].includes(name)) {
          lastWork = event.seq
        }
      }
      if (lastWork < 0 || lastDeclaration > lastWork) return
      reminded.set(agent.session, turn)
      agent.steer(createUserMessage({ content: [{ type: 'text', text:
        'Before finishing, call deliver_files directly with the complete final output list, excluding intermediate and diagnostic files. '
        + 'If this task produced no final files, call it with an empty list. Do not invent paths or claim missing files exist.',
      }], source: { kind: 'plugin', plugin: 'wanwei-final-deliverables' } }))
    })
    child.systemPrompt.section({
      name: 'wanwei:final-deliverables',
      order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES,
      text: 'When a task produces files, call deliver_files with the COMPLETE final delivery list before your final reply. '
        + 'Exclude scratch files, conversion inputs, previews, helper scripts and intermediate documents unless the user requested them as outputs. '
        + 'The tool verifies existing files and replaces any earlier delivery list for this turn. Do not claim delivery if it fails. '
        + 'Only mention these final files in the final reply; do not list processing files. For tasks without output files, do not call it.',
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
