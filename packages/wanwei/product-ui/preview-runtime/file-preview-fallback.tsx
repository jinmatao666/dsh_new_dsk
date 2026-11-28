/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
export function FilePreviewFallback(props: { path: string; title: string; description: string }) {
  return <div class="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
    <strong>{props.title}</strong><p>{props.description.replaceAll('Parvis', 'Buddy')}</p>
  </div>
}
