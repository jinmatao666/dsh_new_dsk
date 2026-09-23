/** Decorative contour illustration. It never represents an uploaded parcel or analysis result. */
export function TerrainIllustration({ className }: { className?: string | undefined }) {
  const contours = [
    'M-24 151 C56 143 74 109 129 121 S207 179 268 135 S350 67 414 103 S501 154 590 65',
    'M-24 137 C51 128 77 93 129 106 S208 164 268 121 S350 53 414 89 S501 140 590 51',
    'M-24 123 C49 113 80 77 129 91 S210 149 268 107 S350 39 414 75 S502 126 590 37',
    'M-24 109 C46 98 82 62 129 76 S211 134 268 93 S350 25 414 61 S503 112 590 23',
    'M-24 95 C44 83 84 47 129 61 S212 119 268 79 S350 11 414 47 S504 98 590 9',
    'M-24 81 C42 68 86 32 129 46 S214 104 268 65 S350 -3 414 33 S505 84 590 -5',
  ]
  return <svg className={className} viewBox="0 0 560 190" fill="none" aria-hidden="true" focusable="false">
    <path d="M0 163 83 132 129 46 182 132 268 65 327 136 414 33 478 126 560 31v159H0Z" fill="currentColor" opacity=".08" />
    {contours.map((path, index) => <path key={path} d={path} stroke="currentColor" strokeWidth={index === 2 ? 1.6 : 1} opacity={index === 2 ? .64 : .35} />)}
    <path d="M0 173h560M0 148h560M0 123h560M0 98h560M0 73h560M0 48h560M40 0v190M95 0v190M150 0v190M205 0v190M260 0v190M315 0v190M370 0v190M425 0v190M480 0v190M535 0v190" stroke="currentColor" opacity=".1" />
    <circle cx="414" cy="33" r="5" fill="currentColor" />
    <path d="M414 42v17" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
  </svg>
}
