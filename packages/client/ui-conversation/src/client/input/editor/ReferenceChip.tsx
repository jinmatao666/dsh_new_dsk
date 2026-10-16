/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { ReferenceIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReferenceIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ReferenceChip.module.css'

/** Display inputs of one chip (the node's cached owner projections). */
export interface ReferenceChipProps {
  readonly label: string
  /** Domain glyph; absent renders the trigger marker instead of an icon. */
  readonly appearance?: ReferenceIconKind | undefined
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
  /** Optional reference navigation; never removes the occurrence. */
  readonly onOpen?: () => void
  /** Optional removal of this occurrence only. */
  readonly onRemove?: () => void
}

/**
 * Render one inline reference chip.
 * @param props - label, optional domain glyph, and the invalid bit.
 * @returns the chip body (icon + truncating label).
 */
export function ReferenceChip({ label, appearance, invalid, onOpen, onRemove }: ReferenceChipProps): ReactNode {
  if (appearance === 'skill' && onOpen !== undefined && onRemove !== undefined) {
    return <span className={clsx(css.chip, css.skill, invalid && css.invalid)} data-reference-kind="skill"
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <button type="button" className={css.open} title={label} onClick={(event) => { event.stopPropagation(); onOpen() }}>
        <ReferenceIcon kind="skill" size={14} className={css.icon} /><span className={css.label}>{label}</span>
      </button>
      <button type="button" className={css.remove} aria-label={`× ${label}`} onClick={(event) => { event.stopPropagation(); onRemove() }}>×</button>
    </span>
  }
  return (
    <span className={clsx(css.chip, invalid && css.invalid)} title={label} data-reference-kind={appearance}>
      {appearance === undefined
        ? <span className={css.marker} aria-hidden>@</span>
        : <ReferenceIcon kind={appearance} size={14} className={css.icon} />}
      <span className={css.label}>{label}</span>
    </span>
  )
}
