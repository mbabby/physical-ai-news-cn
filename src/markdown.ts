/** Serialize an already-validated URL as one Markdown destination, without changing source data. */
export function markdownDestination(url: string): string {
  return `<${url.replace(/[<>\\\u0000-\u0020]/g, (character) => encodeURIComponent(character))}>`;
}
