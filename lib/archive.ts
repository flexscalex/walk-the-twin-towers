// Pure helpers only: this file is imported by client components.
/** Archive capture links for a source: one per local file when the source is a map. */
export function archiveLinks(archived: string | Record<string, string> | null | undefined): { label: string; url: string }[] {
  if (!archived) return [];
  if (typeof archived === "string") return [{ label: archived, url: archived }];
  return Object.entries(archived).map(([file, url]) => ({ label: `${file.replace(/^.*\//, "")}: ${url}`, url }));
}
