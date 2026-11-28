import { workspaceFileIcons } from './workspace-file-icons.ts'

export function WorkspaceFileIcon({ name, directory = false, expanded = false }: {
  name: string
  directory?: boolean
  expanded?: boolean
}) {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? ''
  const type = directory ? expanded ? 'folder-open' : 'folder'
    : /^(docx?|rtf)$/u.test(extension) ? 'word' : /^(xlsx?|csv)$/u.test(extension) ? 'table'
      : /^(pptx?)$/u.test(extension) ? 'powerpoint' : /^(png|jpe?g|gif|webp|bmp|avif|svg)$/u.test(extension) ? 'image'
        : /^(md|markdown)$/u.test(extension) ? 'markdown' : /^(html?)$/u.test(extension) ? 'html' : extension === 'pdf' ? 'pdf' : 'document'
  return <img className="buddy-workspace-file-icon" data-format={type} src={workspaceFileIcons[type]} alt="" aria-hidden="true" />
}
