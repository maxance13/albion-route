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

## Réseau permanent intégré

Le dépôt embarque 636 liaisons fixes entre les zones royales et les Outlands, afin que le calcul ne dépende pas d'un service externe au démarrage. Le graphe est dérivé des données de zones publiques d'[Albion Navigator](https://github.com/SugarF0x/albion-navigator), tandis que le catalogue des cartes provient d'[Albion Roads Mapper](https://github.com/dignityofwar/albionroads).

## Carte communautaire

Les portails d'Avalon sont partagés entre tous les utilisateurs du même serveur Albion (Europe, Amériques ou Asie). Le frontend synchronise les passages actifs toutes les 15 secondes et affiche un graphe avec capacité et compte à rebours.
