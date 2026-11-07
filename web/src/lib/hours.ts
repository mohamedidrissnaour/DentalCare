// Plages d'ouverture (minutes depuis minuit) à partir des paramètres du cabinet.
export function parseRanges(spec: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(part);
    if (m) out.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
  }
  return out;
}
export const rangesFor = (settings: any, d: Date) => parseRanges(settings?.hours?.[d.getDay()] ?? "");
