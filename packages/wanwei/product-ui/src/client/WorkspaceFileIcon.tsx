import { workspaceFileIcons } from './workspace-file-icons.ts'
import { Folder, FolderOpen } from 'lucide-react'

export function WorkspaceFileIcon({ name, directory = false, expanded = false }: {
  name: string
  directory?: boolean
  expanded?: boolean
}) {
  if (directory) {
    const Icon = expanded ? FolderOpen : Folder
    return <Icon className="buddy-workspace-folder-icon" size={16} strokeWidth={1.6} aria-hidden="true" />
  }
  const extension = name.split('.').at(-1)?.toLowerCase() ?? ''
  const type = /^(docx?|rtf)$/u.test(extension) ? 'word' : /^(xlsx?|xlsm|xlsb|csv|tsv|dbf)$/u.test(extension) ? 'table'
    : /^(pptx?)$/u.test(extension) ? 'powerpoint' : /^(png|jpe?g|gif|webp|bmp|avif|svg)$/u.test(extension) ? 'image'
      : /^(md|markdown)$/u.test(extension) ? 'markdown' : /^(html?)$/u.test(extension) ? 'html' : extension === 'pdf' ? 'pdf' : 'document'
  return <img className="buddy-workspace-file-icon" data-format={type} src={workspaceFileIcons[type]} alt="" aria-hidden="true" />
}
