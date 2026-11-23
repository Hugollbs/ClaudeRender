# Claude Render

🇬🇧 [English version](README.md)

Application web **locale** qui visualise le travail de Claude Code à partir de ses transcripts de session
(`~/.claude/projects/**/*.jsonl`). Rien ne quitte votre machine : le serveur écoute sur `127.0.0.1` uniquement.

Deux vues :
- **Timeline** en swimlanes (agent principal + une lane par sous-agent), avec les dépendances en flèches ;
- **Métriques** : durée, tokens, coût estimé, répartition par outil et par agent, réflexion vs action, erreurs, appels répétés.

## Installation et lancement

Prérequis : Node 20+ (testé avec Node 26).

```bash
npm install
npm run dev        # serveur (http://127.0.0.1:3001) + interface (http://localhost:5173)
```

Autres commandes :

```bash
npm test           # tests vitest
npm run typecheck  # vérification TypeScript
npm run build      # build du front dans dist/client (servi ensuite par le serveur Express)
```

Variables d'environnement : `PORT` (défaut 3001), `CLAUDE_PROJECTS_DIR` (défaut `~/.claude/projects`).

## Utilisation

- Choisissez une session en haut (triées par date).
- Molette = zoom, glisser = déplacer, **Shift + glisser** = sélectionner une plage de temps (les métriques suivent).
- Clic sur un bloc = détail à droite ; clic sur le nom d'une lane = filtre les métriques sur ce sous-agent.
- Les lanes de sous-agents sont repliables (▸/▾).

## Structure

```
src/shared/types.ts   modèle de données (Session, Lane, Span, Dependency, Metrics…)
src/shared/metrics.ts calcul des métriques (fonction pure, utilisée côté client)
src/server/parser.ts  parseur JSONL -> Session (testé)
src/server/sessions.ts, index.ts   liste / chargement des sessions, API Express
src/client/           interface React (timeline/ = SVG fait main, d3-scale pour les échelles)
config/pricing.json   barème de prix par modèle (à ajuster, voir ci-dessous)
tests/                tests vitest + fixtures écrites à la main
```

API : `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/pricing`.

## Coût estimé

Les transcripts ne contiennent **pas** le coût en dollars. Il est calculé à partir de `config/pricing.json`
(dollars par million de tokens, par préfixe de modèle). **Les valeurs fournies sont des exemples** :
vérifiez-les et ajustez-les avant de vous y fier.

## Limites connues (liées aux données)

- **Contenu de la réflexion indisponible** : les blocs `thinking` sont vides dans les transcripts. Seule leur durée
  (`thinkingDurationMs`) et leur nombre de tokens sont connus. Les cartes de réflexion n'affichent donc pas de texte.
- **Durées approximatives** : une ligne n'a qu'un seul horodatage. Un outil dure de son `tool_use` à son `tool_result` ;
  un bloc de texte est estimé depuis la ligne précédente ; la position d'une réflexion est déduite de sa durée.
- **Sous-agents en arrière-plan** : leur fin réelle vient d'une `task-notification` envoyée au parent. Si elle est absente
  du transcript, l'agent reste affiché « en cours » plutôt que d'inventer une fin.
- **Sous-agents synchrones** : non observés dans les transcripts utilisés pour écrire le parseur (tous étaient
  asynchrones) ; leur prise en charge n'est pas vérifiée sur des données réelles.
- **Dépendances `data`** : un fichier écrit (Write/Edit) puis lu (Read) plus tard. C'est une heuristique sur le chemin :
  rien ne prouve que la lecture a utilisé la donnée. On ne relie une écriture qu'à la première lecture qui suit.
- **Tokens** : l'usage est recopié sur chaque ligne d'une même requête ; il n'est compté qu'une fois par requête
  (porté par le premier span). Sur une plage étroite, le coût peut donc être attribué à un autre intervalle que l'appel réel.
- **Format non documenté** : le format des transcripts peut changer avec les versions de Claude Code.
- Le rendu visuel n'a été vérifié que par tests unitaires et relecture de code, pas par captures d'écran.

## Licence

MIT
