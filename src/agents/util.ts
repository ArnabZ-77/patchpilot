/** Extracts and parses the last fenced ```json ... ``` block in model output. */
export function extractJson<T>(text: string): T | undefined {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const candidate = blocks.at(-1)?.[1] ?? text;
  try {
    return JSON.parse(candidate.trim()) as T;
  } catch {
    // Try to salvage the first {...} span.
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return undefined;
    }
  }
}
