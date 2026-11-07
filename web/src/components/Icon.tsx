import { iconPaths } from "../lib/icons";

export function Icon({ n, size = 16, className }: { n: string; size?: number; className?: string }) {
  return (
    <svg className={"ico" + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={iconPaths[n] ?? iconPaths.info} />
    </svg>
  );
}
export const notifIcon = (kind: string) => ({
  ordonnance: "ordonnance", imprimee: "imprimante", rdv: "calendrier", arrivee: "salle-attente", fin: "valide",
  securite: "bouclier", success: "valide", error: "erreur", warning: "alerte",
} as Record<string, string>)[kind] ?? "info";

export function Logo({ big }: { big?: boolean }) {
  return (
    <span className={"logo" + (big ? " logo-lg" : "")} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths.dent} /></svg>
    </span>
  );
}
