// Fonctions navigateur : thème, carillon, impression automatique (silencieuse dans l'application de bureau).
declare global {
  interface Window { dcDesktop?: { isDesktop: true; info: () => Promise<any>; saveConfig: (c: any) => Promise<any>; print: (path: string) => Promise<{ ok?: boolean; error?: string }> } }
}

export function applyTheme(t?: string | null) {
  document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
}
export function initTheme() {
  let t: string | null = null;
  try { t = localStorage.getItem("dc-theme"); } catch { /* préférence d'affichage seulement */ }
  applyTheme(t ?? (matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}
export function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("dc-theme", next); } catch { /* sans conséquence */ }
}

let audio: AudioContext | null = null;
/** Petit carillon synthétisé (aucun fichier son). */
export function chime(kind: string) {
  try {
    audio = audio ?? new AudioContext();
    const notes = kind === "ordonnance" ? [784, 988, 1319] : kind === "securite" ? [440, 330] : [659, 880];
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * 0.12;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(audio!.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch { /* son bloqué tant que l'utilisateur n'a pas cliqué */ }
}

/** Impression sans changer de page. Application de bureau : impression silencieuse ; navigateur : iframe invisible. */
export async function autoPrint(path: string) {
  if (!path.startsWith("/impression/")) return;
  if (window.dcDesktop?.print) { await window.dcDesktop.print(path); return; }
  // La page d'impression lance elle-même l'impression dès qu'elle est prête (paramètre auto=1).
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.setAttribute("aria-hidden", "true");
  frame.src = path + (path.includes("?") ? "&" : "?") + "auto=1";
  setTimeout(() => frame.remove(), 120000);
  document.body.appendChild(frame);
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } finally { t.remove(); }
  }
}
