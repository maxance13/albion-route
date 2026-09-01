# Albion Guild Manager — Production
Application web full-stack de gestion de guilde Albion Online.

- Node.js / Express
- PostgreSQL
- JWT + bcrypt + rôles admin/officier/membre
- Membres, événements, présences, loot, payouts, trésorerie, recrutement
- Taxe de payout 15 % par défaut
- Frontend SPA responsive servi par l'API

## Variables d'environnement
- `DATABASE_URL` : connexion PostgreSQL
- `JWT_SECRET` : secret JWT long et aléatoire
- `NODE_ENV=production`

Au premier lancement, ouvrir le site puis choisir « Premier lancement ? Créer l'admin ».
