/** Shared service-failure presentation; callers provide localized copy and actual request state. */
import './service-unavailable.css'
import { useId } from 'react'

/** Display a service-specific failure without inferring connectivity from deployment labels.
 * @param props - Illustration subject and localized service description.
 * @returns Large content-area placeholder.
 */
export function ServiceUnavailable({ variant, title, description, hint }: {
  variant: 'skillhub' | 'experts' | 'connectors'
  title: string
  description: string
  hint?: string
}) {
  const artworkId = useId()
  const paper = `url(#${artworkId}-paper)`
  const blue = `url(#${artworkId}-blue)`
  const shadow = `url(#${artworkId}-shadow)`
  return <div className={`wanwei-service-unavailable wanwei-service-unavailable-${variant}`} role="alert">
    <svg className="wanwei-service-unavailable-art" viewBox="0 0 360 240" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${artworkId}-paper`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff" /><stop offset="1" stopColor="#f2f6fd" />
        </linearGradient>
        <linearGradient id={`${artworkId}-blue`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#8eb5ff" /><stop offset="1" stopColor="#598af0" />
        </linearGradient>
        <filter id={`${artworkId}-shadow`} x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#6584b5" floodOpacity=".13" />
        </filter>
      </defs>
      <path d="M59 161C30 112 74 51 134 46c48-4 63-25 111-7 64 24 90 88 56 133-37 48-211 42-242-11Z" fill="#f2f6fc" />
      <ellipse cx="180" cy="216" rx="119" ry="11" fill="#eaf0f9" opacity=".65" />
      {variant === 'skillhub' && <>
        <path d="M113 103a27 27 0 0 1 0-54 35 35 0 0 1 65-13 27 27 0 0 1 35 26 21 21 0 0 1-1 42Z" fill={paper} stroke="#c2d4f0" strokeWidth="1.5" filter={shadow} />
        <path d="m144 70 9-9 9 9m-9-9v24" fill="none" stroke="#95b4e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M153 109v22m-49-21-15 22m115-25 18 25" stroke="#bdceed" strokeWidth="1.5" strokeDasharray="4 5" fill="none" />
        <g transform="rotate(-13 83 140)" filter={shadow}>
          <rect x="51" y="107" width="57" height="70" rx="9" fill={paper} stroke="#d4dfef" />
          <rect x="62" y="119" width="24" height="27" rx="5" fill="#dce9ff" />
          <path d="M68 126h12m-12 6h9m-15 24h30m-30 7h20" stroke="#a9bedf" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g transform="rotate(12 271 112)" filter={shadow}>
          <rect x="245" y="78" width="53" height="65" rx="9" fill={paper} stroke="#d4dfef" />
          <path d="m262 95-7 7 7 7m14-14 7 7-7 7m-6-16-4 19" fill="none" stroke="#99afe0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M257 124h29m-23 6h17" stroke="#d1dced" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g filter={shadow} strokeLinejoin="round">
          <path d="m111 144 68-29 70 29-70 32Z" fill="#d7e5fc" stroke="#a8c2ee" strokeWidth="1.5" />
          <path d="m111 144 68 31v45l-68-33Z" fill="#e4edfc" stroke="#b7cdee" strokeWidth="1.5" />
          <path d="m179 175 70-31v43l-70 33Z" fill="#c6dafa" stroke="#aac3eb" strokeWidth="1.5" />
          <path d="m111 144-17 20 68 31 17-20m70-31 16 20-69 31-17-20" fill={paper} stroke="#b7cdee" strokeWidth="1.5" />
        </g>
        <g transform="rotate(-5 181 131)" filter={shadow}>
          <rect x="152" y="100" width="57" height="61" rx="12" fill={blue} />
          <path d="m180 111 5 13 13 6-13 5-5 14-5-14-13-5 13-6Z" fill="#fff" />
        </g>
        <circle cx="283" cy="174" r="18" fill={paper} stroke="#c6d6ed" filter={shadow} />
        <path d="M276 174h14m-7-7v14" stroke="#99b5e2" strokeWidth="2" strokeLinecap="round" />
      </>}
      {variant === 'experts' && <>
        <g transform="rotate(-13 96 139)" filter={shadow}>
          <rect x="55" y="81" width="85" height="112" rx="12" fill={paper} stroke="#cbd9ed" />
          <circle cx="97" cy="115" r="16" fill="#e6edf8" />
          <path d="M81 139c2-19 30-19 32 0" fill="#d3dff0" />
          <path d="M73 157h48m-48 8h32m-32 13h18" stroke="#cbd8ea" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g transform="rotate(11 268 133)" filter={shadow}>
          <rect x="229" y="79" width="76" height="109" rx="12" fill={paper} stroke="#cbd9ed" />
          <circle cx="267" cy="109" r="14" fill="#e2e8f7" />
          <path d="M252 134c1-18 29-18 30 0" fill="#ccd7ef" />
          <path d="M245 151h43m-43 8h28m-28 13h16" stroke="#cbd8ea" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g filter={shadow}>
          <rect x="123" y="47" width="116" height="159" rx="15" fill={paper} stroke="#adc5e9" strokeWidth="1.5" />
          <path d="M138 47h86a15 15 0 0 1 15 15v17H123V62a15 15 0 0 1 15-15Z" fill="#e2edfd" />
          <rect x="139" y="59" width="38" height="5" rx="2.5" fill="#b4cbed" />
          <circle cx="220" cy="62" r="3" fill="#adc5e9" />
          <circle cx="181" cy="111" r="26" fill="#e5edfb" />
          <path d="M158 128c2-23 44-23 46 0a26 26 0 0 1-46 0Z" fill="#96b4e6" />
          <circle cx="181" cy="104" r="10" fill="#b6cdef" />
          <path d="M153 153h56m-46 10h36" stroke="#bacce8" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="144" y="181" width="32" height="10" rx="5" fill="#e2ebfa" />
          <rect x="182" y="181" width="35" height="10" rx="5" fill="#e2ebfa" />
        </g>
        <g filter={shadow}>
          <path d="M238 28h49a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10h-28l-14 10V70h-7a10 10 0 0 1-10-10V38a10 10 0 0 1 10-10Z" fill={paper} stroke="#c7d8ef" />
          <circle cx="246" cy="49" r="3" fill="#a1bce6" /><circle cx="262" cy="49" r="3" fill="#a1bce6" /><circle cx="278" cy="49" r="3" fill="#a1bce6" />
        </g>
        <circle cx="234" cy="190" r="22" fill={blue} stroke="#fff" strokeWidth="4" filter={shadow} />
        <path d="M234 179v12m0 7v1" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </>}
      {variant === 'connectors' && <>
        <path d="M66 65V47a10 10 0 0 1 10-10h170a10 10 0 0 1 10 10v25M81 179v17a9 9 0 0 0 9 9h180a9 9 0 0 0 9-9v-16" fill="none" stroke="#cad9ee" strokeWidth="1.5" strokeDasharray="4 5" />
        <g transform="rotate(-6 103 116)" filter={shadow}>
          <rect x="42" y="66" width="122" height="110" rx="13" fill={paper} stroke="#c2d3ed" strokeWidth="1.5" />
          <path d="M55 66h96a13 13 0 0 1 13 13v13H42V79a13 13 0 0 1 13-13Z" fill="#e4edfb" />
          <circle cx="55" cy="80" r="2.5" fill="#afc5e5" /><circle cx="64" cy="80" r="2.5" fill="#c5d5eb" /><circle cx="73" cy="80" r="2.5" fill="#c5d5eb" />
          <rect x="57" y="108" width="33" height="33" rx="9" fill="#dbe8fc" />
          <path d="M66 117h6v6h-6Zm10 0h6v6h-6Zm-10 10h6v6h-6Zm10 0h6v6h-6Z" fill="#91afe0" />
          <path d="M101 116h43m-43 10h29m-43 28h57" stroke="#c4d3e8" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g transform="rotate(7 260 129)" filter={shadow}>
          <rect x="201" y="79" width="119" height="113" rx="13" fill={paper} stroke="#c2d3ed" strokeWidth="1.5" />
          <path d="M214 79h93a13 13 0 0 1 13 13v13H201V92a13 13 0 0 1 13-13Z" fill="#e4edfb" />
          <circle cx="214" cy="93" r="2.5" fill="#afc5e5" /><circle cx="223" cy="93" r="2.5" fill="#c5d5eb" /><circle cx="232" cy="93" r="2.5" fill="#c5d5eb" />
          <rect x="218" y="120" width="31" height="31" rx="9" fill="#e2e8f8" />
          <path d="M226 130h15m-15 5h15m-15 5h10" stroke="#9dade0" strokeWidth="2" strokeLinecap="round" />
          <path d="M259 127h42m-42 10h27m-41 31h56" stroke="#c4d3e8" strokeWidth="3" strokeLinecap="round" />
        </g>
        <path d="M93 172v14a11 11 0 0 0 11 11h38v-31m119 25v9a11 11 0 0 1-11 11h-38v-40" fill="none" stroke="#b2c8e9" strokeWidth="3" strokeLinecap="round" />
        <g transform="rotate(-24 178 158)" filter={shadow} strokeLinejoin="round">
          <path d="M138 147h27v30h-12a15 15 0 0 1-15-15Z" fill={paper} stroke="#9db9e5" strokeWidth="2" />
          <path d="M192 147h12a15 15 0 0 1 15 15v15h-27Z" fill={blue} stroke="#83a8e5" strokeWidth="2" />
          <path d="M165 154h9m-9 15h9" stroke="#9db9e5" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <path d="m173 124-3-8m14 7 4-8m6 16 8-2" fill="none" stroke="#9db9e5" strokeWidth="2" strokeLinecap="round" />
        <rect x="90" y="26" width="28" height="23" rx="7" fill={paper} stroke="#d0ddef" />
        <path d="m99 37 4 4 7-8" fill="none" stroke="#b7c9e4" strokeWidth="2" strokeLinecap="round" />
      </>}
    </svg>
    <h3>{title}</h3><p>{description}</p>
    {hint && <p className="wanwei-service-unavailable-hint">{hint}</p>}
  </div>
}
