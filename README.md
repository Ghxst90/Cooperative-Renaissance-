# Coopérative Renaissance

Site de la Coopérative Renaissance, avec un serveur (Node.js + SQLite) qui enregistre ce que les visiteurs envoient et un espace de gestion pour l'équipe.

## Ce que fait le site

**Côté visiteurs**
- **Adhésion** : la demande est enregistrée et le visiteur reçoit une référence (ex. `ADH-2026-4F2A9C`).
- **Suivi de demande** : avec sa référence et son téléphone, le visiteur voit si sa demande est en attente, validée ou refusée.
- **Promesse de don** : montant, nom, téléphone et moyen de paiement (Mobile Money, Orange Money, virement, espèces). L'équipe rappelle pour finaliser ; le site n'encaisse pas d'argent.
- **Contact** et **newsletter** : messages et e-mails sont enregistrés.
- **Chiffres en direct** : le nombre de membres affiché augmente quand une adhésion est validée.
- **Actualités** : la section « Nos dernières actions » affiche ce que l'équipe publie (elle reste cachée tant qu'il n'y a rien).

**Côté équipe : `/admin`** (protégé par mot de passe)
- Tableau de bord : demandes à traiter, dons reçus, messages non lus, abonnés.
- Valider ou refuser les adhésions, marquer les dons comme reçus, marquer les messages comme lus.
- Publier des actualités sur le site.
- Télécharger chaque liste en fichier CSV (s'ouvre dans Excel).

Protections : validation des champs, limite d'envois par personne, piège anti-robots.

## Lancer le site sur son ordinateur

Il faut **Node.js 22.13 ou plus récent**.

```bash
npm install
cp .env.example .env      # puis choisir un mot de passe dans ADMIN_PASSWORD
npm start
```

Ouvrir http://localhost:3000 pour le site et http://localhost:3000/admin pour la gestion.

## Mise en ligne

GitHub Pages ne fait tourner que des pages statiques, pas de serveur. Il faut un hébergeur Node.js (Render, Railway, Fly.io, un VPS…) :

- commande d'installation : `npm install`
- commande de démarrage : `npm start`
- variables d'environnement : `ADMIN_PASSWORD` (obligatoire pour `/admin`), `BASE_MEMBRES` (facultatif, 120 par défaut), `DATA_DIR` (dossier de la base de données)

⚠️ La base de données est un fichier (`data/renaissance.db`). Sur les offres gratuites où le disque est effacé à chaque redémarrage, les données sont perdues : il faut un **disque persistant** et pointer `DATA_DIR` dessus.

Si le site est ouvert sans serveur (par exemple sur GitHub Pages), les formulaires repassent automatiquement à l'ancien fonctionnement : ils ouvrent la messagerie du visiteur.

## Organisation des fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | le site public |
| `public/admin.html` | l'espace de gestion |
| `server.js` | le serveur et l'API |
| `db.js` | la base de données SQLite |
