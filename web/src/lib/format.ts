import { parseDt } from "../../../shared/domain";

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const money = (n: number | null | undefined) => eur.format(Number(n ?? 0));
export const dt = (s: string | null | undefined) => parseDt(s);
const f = (s: string | null | undefined, o: Intl.DateTimeFormatOptions) => { const d = parseDt(s); return d ? d.toLocaleString("fr-FR", o) : "-"; };
export const dDate = (s: string | null | undefined) => f(s, { day: "2-digit", month: "2-digit", year: "numeric" });
export const dTime = (s: string | null | undefined) => (s ? s.slice(11, 16) : "-");
export const dDayTime = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : "-");
export const dLong = (s: string | null | undefined) => f(s, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const dLongShort = (s: string | null | undefined) => f(s, { weekday: "long", day: "numeric", month: "long" });
export const dWeekday = (s: string | null | undefined) => f(s, { weekday: "long" });
export function ago(s: string) {
  const d = parseDt(s); if (!d) return "";
  const m = (Date.now() - d.getTime()) / 60000;
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${Math.floor(m)} min`;
  if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
  return dDayTime(s);
}
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
