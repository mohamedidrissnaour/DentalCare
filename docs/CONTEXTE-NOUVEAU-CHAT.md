# DentaCare : contexte pour reprendre dans un nouveau chat

> À coller au début d'une nouvelle conversation avec Claude, en joignant le dossier du projet si possible.

## 1. Le projet

- **DentaCare** : logiciel de gestion de cabinet dentaire, **hors ligne**, en réseau local. Un poste serveur garde la base, les autres postes (docteurs, secrétaires) s'y connectent par navigateur ou par l'application Electron en mode client.
- Projet d'apprentissage personnel de Mohamed.
- Dépôt GitHub (personnel, public) : https://github.com/mohamedidrissnaour/DentalCare
- Dossier de travail local : `C:\Dev\DentaCare-React` (dépôt Git relié à GitHub, branche `main`).
- Une ancienne version .NET 10 / Blazor existe encore (dossier `outputs\DentaCare`), elle n'est plus développée.

## 2. Pile technique

| Couche | Choix |
|---|---|
| Interface | React 19 + TypeScript, Vite 7, react-router-dom 7 |
| Styles | CSS maison : `web/src/styles/tokens.css` (couleurs, espacements) + `app.css`, thème clair et sombre |
| Serveur | Node.js 22 + Express 5, API REST sous `/api` |
| Temps réel | Server-Sent Events (`/api/events`) : file d'attente, agenda, ordonnances, notifications, permissions |
| Base | SQLite via sql.js (WebAssembly), fichier `dentacare.db`, écriture atomique, schéma versionné (`PRAGMA user_version`) |
| Bureau | Electron 45 (mode serveur ou client, impression silencieuse des ordonnances) |
| Sécurité | bcrypt coût 12, cookie de session HttpOnly + SameSite=Strict (12 h, stockée hachée en base), en-tête anti-CSRF `X-DentaCare: 1`, permissions vérifiées côté serveur |
| Construction | Vite (interface), esbuild via `scripts/build-server.mjs` (serveur + Electron) |

Structure :

```
electron/        main.ts, preload.ts, connect.html/.js (choix serveur ou client)
server/src/      db/, security/, services/, routes/api.ts, obs/ (log, métriques, bus SSE), index.ts, selftest.ts
shared/          domain.ts (rôles, statuts, libellés, catalogue des permissions, dates), rx.ts (validation d'ordonnance)
web/src/         pages/ (+ admin/, print/), components/, lib/ (api, session, toasts, desktop, format, hooks, hours, icons), styles/
docs/captures/   captures d'écran utilisées par le README
```

## 3. Fonctionnalités en place (toutes testées)

- **Comptes** : créés au premier démarrage, `docteur` (docteur principal, administrateur) et `secretaire`, mots de passe temporaires aléatoires affichés une fois (console + `identifiants-initiaux.txt`), changement obligatoire. Seul le principal crée les autres comptes. Rôles : Principal, Docteur, Secrétaire. 20 permissions configurables (les actes cliniques ne sont jamais accordables à une secrétaire).
- **File d'attente** : arrivée d'un patient connu ou nouveau, numéro du jour, patient en cours en vert, urgences en tête, patients avec RDV prioritaires dès leur heure (fenêtre 5 min), carte « Rendez-vous attendus » avec bouton téléphone vert et fenêtre d'appel en verre dépoli, motif déclaré puis corrigé par le praticien, n'importe quel docteur peut prendre n'importe quel patient.
- **Agenda** : vues jour et semaine, règles (horaires, chevauchements, durée, passé, urgence), créneaux libres, workflow des statuts.
- **Dossier patient** : infos en haut, indicateurs (soins, payé, reste à payer, passages…), consultations par jour avec heure d'arrivée, paiements par date, traitements en plusieurs séances, RDV, ordonnances, archivage, anonymisation RGPD. Pas de schéma dentaire (retiré à la demande).
- **Ordonnances** : modèles, catalogue de médicaments, alerte allergie, envoi au secrétariat avec notification instantanée, file d'impression, impression auto, mise en page (en-tête cabinet, titre ORDONNANCE souligné, Docteur, Ville + date, pied de page avec adresse / tél / fax).
- **Facturation**, **journal de caisse**, **patients à rappeler**, **pilotage par praticien**, **paramètres**, **supervision**, **journaux**, **audit**, **sauvegardes quotidiennes**, **données de démo**.
- `npm run selftest` : 51 contrôles, tous verts. Parcours complet testé en navigateur (docteur + secrétaire), aucune erreur.

## 4. Règles à respecter

- Tout en **français**, ton professionnel, **aucun tiret cadratin (—)** dans le projet.
- Palette actuelle : thème « Poket » (turquoise `#14B1BB`, `#21CDC0`, anthracite `#222429`, gris `#696969` / `#F7F7F7`, vert `#1BAE7E`, orange `#FF5E14`, jaune `#FCBF64`, rouge `#EA3747`).
- Politique de sécurité du poste (géré par Cdiscount) : pas de secret en dur, SQL paramétré, entrées validées, pas de données personnelles ni de secrets dans les journaux, pas de démarrage automatique furtif, pas de `-ExecutionPolicy Bypass`, dépendances du registre officiel avec versions figées, note de sécurité pour tout outil déployé.
- Ne jamais demander ni écrire de mot de passe ou de jeton dans la conversation.

## 5. Environnement de Mohamed

- Windows 11, PowerShell, Node 22.23.4 (géré par Volta), Git (déjà connecté au TFS de l'équipe ; le dépôt GitHub a une configuration **locale** `user.name` / `user.email` noreply, sans impact sur le TFS).
- **Disque C: presque plein** : garder au moins 5 Go libres (caches nettoyés le 07/11/2026).
- **Proxy d'entreprise avec inspection HTTPS** : Node ne peut pas télécharger le binaire Electron depuis GitHub, et le zip téléchargé par PowerShell avait une empreinte SHA-256 différente de l'officielle (`489cd061…` attendue, `d9030ff7…` reçue). Fichier supprimé, à traiter avec l'IT / la Sécurité. **Ne pas désactiver la vérification des certificats.**
- En attendant, l'application tourne dans le navigateur :

```powershell
cd C:\Dev\DentaCare-React
npm run build
npm run serve      # puis http://localhost:5080
```

- Claude in Chrome était déconnecté en fin de session : le reconnecter (panneau latéral Claude, même compte) pour que Claude puisse voir les sites.

## 6. Prochaines étapes demandées

1. **Nouveau thème inspiré de https://demo.docliq.site/dashboard** (application « Ocliq », gestion dentaire) :
   - garder **toutes** les fonctionnalités actuelles ;
   - reprendre le style (couleurs, menu latéral, cartes, typographie, espacements) sans copier le site à l'identique ;
   - textes relus et bien écrits, tout **centré et bien cadré**, aucun élément mal positionné ;
   - **responsive** sur tous les écrans (portable 13 pouces jusqu'au grand écran), menu latéral repliable.
   - Le site est une application JavaScript : il faut un vrai navigateur (Claude in Chrome) pour l'étudier.
2. Obtenir Electron depuis une source approuvée (IT), puis tester `npm start` et `npm run dist`.
3. Mettre à jour proprement les outils de construction signalés par `npm audit` (6 alertes modérées dans electron-builder et ses dépendances), sans `npm audit fix --force`.
4. Plus tard : un site vitrine WordPress à partir d'un thème gratuit (demandé, mis de côté).

## 7. Commandes utiles

| Commande | Effet |
|---|---|
| `npm install` | Installe les dépendances (après un clone) |
| `npm run build` | Construit l'interface et le serveur dans `dist/` |
| `npm run serve` | Serveur + interface sur http://localhost:5080 |
| `npm start` | Construit puis ouvre Electron |
| `npm run selftest` | Auto-test des règles (51 contrôles) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run reset-password -- docteur` | Nouveau mot de passe temporaire (application arrêtée) |
| `git add . ; git commit -m "…" ; git push` | Publier sur GitHub |

## 8. Pièges déjà rencontrés

- `package-lock.json` généré sous Linux : il manque les binaires Windows (`@rollup/rollup-win32-x64-msvc`). Le régénérer sur Windows (`npm install`). Celui du dépôt est déjà le bon.
- Ne pas mettre un sélecteur de patient (liste déroulante avec bouton « changer ») dans un `<label>` : le clic est relayé au bouton et annule la sélection. Utiliser `<div className="field">`.
- Les dates des soins sont fixées par l'horloge du **serveur** (le client n'envoie que le jour).
- En test automatisé (Chromium du bac à sable), ajouter `--enable-features=NetworkServiceInProcess`, sinon les cookies disparaissent au bout de 30 s (artefact de l'environnement, pas de l'application).
