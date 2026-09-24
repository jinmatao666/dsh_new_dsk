import { geologyIconImages } from './GeologyIconData.ts'
import { meetingIconImages } from './MeetingIconData.ts'

export function ExpertProfileIcon({ icon, fallbackImage }: { icon?: string | undefined; fallbackImage?: string | undefined }) {
  const shared = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': true as const }
  if (icon?.startsWith('data:image/')) return <img src={icon} alt="" aria-hidden="true" />
  if (icon === 'gis') return <img src={geologyIconImages.mountain} alt="" aria-hidden="true" />
  if (icon === 'survey') return <img src={geologyIconImages.layers} alt="" aria-hidden="true" />
  if (icon === 'planning') return <img src={geologyIconImages.coordinate} alt="" aria-hidden="true" />
  if (icon === 'meeting') return <img src={meetingIconImages.expert} alt="" aria-hidden="true" />
  if (icon === 'policy') return <svg {...shared}><path d="M8 4h10l4 4v15H8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M18 4v5h4M11 14h8M11 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (icon === 'ecology') return <svg {...shared}><path d="M21 5c-9 .4-14 5-14 12 0 3.4 2.5 5.8 5.6 5.8C19 22.8 22 15.7 21 5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M8 20c3-3.8 6.1-6.3 10.4-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  if (icon === 'property') return <svg {...shared}><path d="m5 13 9-8 9 8v10H5V13Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M11 23v-6h6v6" stroke="currentColor" strokeWidth="2" /></svg>
  if (fallbackImage !== undefined) return <img src={fallbackImage} alt="" aria-hidden="true" />
  return <svg {...shared}><path d="M7 5h14v18H7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M10 10h8M10 14h8M10 18h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}
