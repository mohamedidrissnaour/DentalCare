import crypto from "node:crypto";
import bcrypt from "bcryptjs";

/** Hachage bcrypt (coût 12), conforme à la politique interne (Argon2 / bcrypt). */
export const hashPassword = (pwd: string) => bcrypt.hashSync(pwd, 12);
export const verifyPassword = (pwd: string, hash: string) => { try { return bcrypt.compareSync(pwd, hash); } catch { return false; } };
export const dummyHash = hashPassword(crypto.randomUUID());

/** Règles : 10 à 128 caractères, une majuscule, une minuscule, un chiffre. */
export function validatePassword(p: unknown): string | null {
  if (typeof p !== "string" || p.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (p.length > 128) return "Le mot de passe est trop long (128 caractères maximum).";
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/\d/.test(p)) return "Le mot de passe doit contenir une majuscule, une minuscule et un chiffre.";
  return null;
}

/** Mot de passe temporaire lisible (sans caractères ambigus), tiré par un générateur cryptographique. */
export function temporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnpqrstuvwxyz", digits = "23456789", all = upper + lower + digits;
  const pick = (s: string) => s[crypto.randomInt(s.length)];
  const c = [pick(upper), pick(lower), pick(digits)];
  while (c.length < 12) c.push(pick(all));
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join("");
}
export const newStamp = () => crypto.randomBytes(16).toString("hex");
