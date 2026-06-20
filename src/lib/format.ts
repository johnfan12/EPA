export function formatDate(value: string) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 16);
}

export function splitTags(tags: string) {
  return tags
    .split(/[，,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Strips a single surrounding ```/```markdown code fence the model may add. */
export function stripCodeFence(text: string) {
  const match = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

export function deriveTitle(content: string, fallback: string) {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine ?? fallback).slice(0, 40);
}
