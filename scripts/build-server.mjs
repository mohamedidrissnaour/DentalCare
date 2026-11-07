// Construit le serveur Node et le processus principal Electron (un fichier chacun, dépendances npm externes).
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", packages: "external", logLevel: "warning" };
await build({ ...common, entryPoints: ["server/src/index.ts"], outfile: "dist/server/index.cjs" });
await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist/electron/main.cjs", external: ["electron"] });
await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist/electron/preload.cjs", external: ["electron"] });
mkdirSync("dist/electron", { recursive: true });
cpSync("electron/connect.html", "dist/electron/connect.html");
cpSync("electron/connect.js", "dist/electron/connect.js");
console.log("Serveur et Electron construits dans dist/");
