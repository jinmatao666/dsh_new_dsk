/* oxlint-disable -- Parvis source retained with its original control flow and types; see preview-runtime/LICENSE. */
import { Component, createMemo } from "solid-js"
import DOMPurify from "dompurify"

export const HtmlPreview: Component<{
  content: string
}> = (props) => {
  const sanitized = createMemo(() => DOMPurify.sanitize(props.content, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script"],
    }))

  return <iframe srcdoc={sanitized()} class="w-full border-none h-full" sandbox="" title="HTML Preview" />
}
