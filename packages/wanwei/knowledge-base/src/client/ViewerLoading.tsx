/** Centered visual loading mark with no visible copy.
 * @param props - Accessible status label.
 * @returns Loading indicator.
 */
export function ViewerLoading({ label }: { label: string }) {
  return <div className="dsh-knowledge-viewer-loading" role="status" aria-label={label}>
    <span className="dsh-knowledge-viewer-loading-mark" aria-hidden="true">
      <span className="dsh-knowledge-viewer-loading-core" />
    </span>
  </div>
}
