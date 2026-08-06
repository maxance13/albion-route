# Albion Route

Planificateur communautaire pour Albion Online : catalogue complet des cartes, portails temporaires des Routes d'Avalon, capacité 7/20 joueurs, compte à rebours et calcul d'itinéraire.

## Architecture

- Frontend statique : Vercel
- API Node/Express : Render
- Base PostgreSQL : Neon
- Catalogue : Albion Roads Mapper / données communautaires Albion
- Réseau permanent : chargé lorsque la source cartographique publique est disponible

## Variables Render

- `DATABASE_URL` : chaîne PostgreSQL Neon
- `PORT` : fourni automatiquement par Render

## Développement

```bash
npm install
DATABASE_URL=postgresql://... npm start
```

Le site est indépendant de Sandbox Interactive GmbH et d'Albion Online.
