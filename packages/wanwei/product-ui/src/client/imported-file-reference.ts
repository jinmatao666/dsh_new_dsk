import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Keep the model's path reference while presenting only the imported file or folder name. */
export function importedFileReference(path: string): ReferenceInsert {
  if (path === '' || /[\u0000-\u001f\u007f-\u009f"]/u.test(path)) throw new Error('导入后的文件路径包含不支持的字符')
  const mention = /\s/u.test(path) ? `@"${path}"` : `@${path}`
  const directory = /[\\/]$/u.test(path)
  const name = path.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1) ?? path
  return {
    source: 'reference',
    ref: mention,
    clipboardText: mention,
    label: name,
    appearance: directory ? 'folder' : 'file',
  }
}
