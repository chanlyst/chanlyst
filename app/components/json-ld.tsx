/**
 * Emits a structured-data document into the HTML.
 *
 * Server-side and shared by every page that has schema, so the escaping below
 * is written once. Every "<" is neutralised: the content is ours today, but it
 * is edited copy, and one closing tag inside a string would end the script
 * element early and spill markup into the page.
 */
export default function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
