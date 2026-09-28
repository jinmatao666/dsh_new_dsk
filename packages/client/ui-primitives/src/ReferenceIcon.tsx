import type { ReactNode } from 'react'
import {
  IconBrowseOutline16, IconFolderClose16,
} from './icons/index.tsx'

/** Reference domains with distinct composer and transcript glyphs. */
export type ReferenceIconKind = 'session' | 'file' | 'folder' | 'skill'

/** Props shared by inline reference glyphs. */
export interface ReferenceIconProps {
  kind: ReferenceIconKind
  size?: number
  className?: string | undefined
}

/**
 * Render the icon that identifies one inline reference domain.
 * @param props - Reference kind, optional size, and optional CSS class.
 * @returns The corresponding current-color SVG glyph.
 */
export function ReferenceIcon({ kind, size = 16, className }: ReferenceIconProps): ReactNode {
  switch (kind) {
    case 'skill':
      return <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M6.5 3.5C7.1 6.4 8.1 7.4 11 8C8.1 8.6 7.1 9.6 6.5 12.5C5.9 9.6 4.9 8.6 2 8C4.9 7.4 5.9 6.4 6.5 3.5Z"
          stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M12 1.5C12.3 3.1 12.9 3.7 14.5 4C12.9 4.3 12.3 4.9 12 6.5C11.7 4.9 11.1 4.3 9.5 4C11.1 3.7 11.7 3.1 12 1.5Z"
          fill="currentColor" />
      </svg>
    case 'session':
      return (
        <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M8 0.597656C3.91296 0.597656 0.599716 3.91103 0.599609 7.99805C0.599609 9.13171 0.854567 10.2079 1.31152 11.1699L1.59277 11.7607L2.77441 11.1992L2.49414 10.6084L2.36035 10.3076C2.06865 9.59612 1.90723 8.81645 1.90723 7.99805C1.90733 4.63362 4.63554 1.90625 8 1.90625C11.3644 1.90635 14.0917 4.63368 14.0918 7.99805C14.0918 11.3625 11.3644 14.0907 8 14.0908C7.311 14.0908 6.80642 14.0414 6.35938 13.918C5.919 13.7963 5.50105 13.5929 5.00098 13.2441C4.26805 12.7329 3.21756 12.5526 2.35156 13.0996L2.33789 13.1084L2.32422 13.1182L1.74805 13.5234L2.18164 14.8184L3.05957 14.2002C3.37505 14.0068 3.84248 14.0319 4.25195 14.3174C4.84447 14.7307 5.39718 15.009 6.01172 15.1787C6.61963 15.3465 7.25579 15.3984 8 15.3984C12.087 15.3983 15.4004 12.0851 15.4004 7.99805C15.4003 3.9111 12.087 0.59776 8 0.597656ZM4.56836 8.50977V9.80371H8.12402V8.50977H4.56836ZM4.56836 7.30078H11.4619V6.00684H4.56836V7.30078Z"
            fill="currentColor"
          />
        </svg>
      )
    case 'file': return <IconBrowseOutline16 size={size} className={className} />
    case 'folder': return <IconFolderClose16 size={size} className={className} />
  }
}
