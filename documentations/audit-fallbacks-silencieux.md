# Audit & Élimination des Fallbacks Silencieux

> Audit du serveur (`onesatserver`) et du client (`onesatclient`) pour éliminer les patterns du type `username || ""` qui masquent les données manquantes et causent des bugs UI comme « vote 5 sats par  ».

## Context

L'utilisateur observe des bugs UI comme « vote 5 sats par  » (nom vide affiché) qui viennent de fallbacks silencieux dans le code (`username || ""`, `userName: null`, etc.). Ces fallbacks masquent des données manquantes au lieu de les signaler.

**Décisions prises :**
- **Portée :** Serveur (`onesatserver`) + Client (`onesatclient`)
- **Stratégie serveur :** Échec dur → throw `GraphQLError` quand une donnée requise manque
- **Legacy :** Ignoré — on ne migre pas les données existantes corrompues, on bloque seulement les nouvelles entrées

**Objectif :** Éliminer les chemins de code qui transforment "donnée absente" en "chaîne vide affichée" pour que les bugs soient visibles et corrigés à la source plutôt que cachés dans l'UI.

---

## Findings Critiques (HIGH severity)

### Serveur — `onesatserver`

| # | Fichier:ligne | Problème | Action |
|---|---|---|---|
| S1 | `src/resolvers/queries.ts:141-143` | `getCampaignsVoted` retourne `["djskdj"]` hardcodé | Implémenter avec `dataSourcesRedis.getVoted(uid)` |
| S2 | `src/resolvers/mutations.ts:280` | `pubsub.publish` même quand `voteResponse.vote` est `null` | Ne publier que si `voteResponse.success === true` |
| S3 | `src/resolvers/mutations.ts:70` | `validateVote` n'échoue pas sur `userName` vide ou whitespace | Ajouter check explicite `userName.trim() !== ''` avec throw `GraphQLError` |
| S4 | `src/datasourcesmongo.ts:270, 297, 322, 355` | `getCampaigns` catch + return `[]` masque les erreurs DB | Re-throw `GraphQLError` au lieu de retourner array vide |
| S5 | `src/resolvers/queries.ts:198-202`, `173-175`, `46-65` | `{ ...user }` sans null-check | Throw si `user === null` |
| S6 | `src/datasourcesredis.ts:551-559` | `getVoteById` retourne `null` mais signature dit `Promise<Vote>` | Throw `GraphQLError` "Vote not found" |
| S7 | `src/index.ts:140` | `decodedToken.uid` peut être undefined (théoriquement) → `userId` undefined | Throw si `!decodedToken.uid` après vérif token |

### Client — `onesatclient`

| # | Fichier:ligne | Problème | Action |
|---|---|---|---|
| C1 | `screens/DashboardScreens/PollOptionDetailsScreen.tsx:150` | `userName: newVote.userName \|\| null` jette le nom à la poubelle | Passer `userName: newVote.userName` directement (laisser le serveur garantir non-null) |
| C2 | `screens/DashboardScreens/PollOptionDetailsScreen.tsx:304` | `{vote.userName}` rendu cru, peut être vide | Si blind vote → afficher "Anonyme" explicitement, sinon rendre tel quel |
| C3 | `screens/DashboardScreens/VoteDetailsScreen.tsx:56` | Rendu direct de `userName` route param | Validation à la navigation : ne pas naviguer sans userName |
| C4 | `screens/DashboardScreens/AddVoteScreen.tsx:94` | `user?.displayName \|\| user?.email?.split('@')[0] \|\| 'anonymous'` | Throw/early-return si pas de displayName Firebase. Ne JAMAIS envoyer 'anonymous' au serveur. |
| C5 | `screens/DashboardScreens/HomeScreen.tsx:67-68` | `email \|\| ""` et `userName: ... \|\| "user"` envoyés à `ensureUserInDB` | Bloquer la mutation si email ou displayName manque |
| C6 | `screens/DashboardScreens/CampaignsScreen.tsx:42` | `const uid = user?.uid \|\| ""` | Early-return ou redirect login si pas d'uid |
| C7 | `components/AuthorLabel.tsx:19-22` | Retourne `null` silencieusement si pas de userName | Afficher "(?)" ou "[utilisateur supprimé]" pour signaler |

---

## Plan d'Exécution (par ordre)

### Phase 1 — Serveur d'abord (la source)

Si on durcit le serveur en premier, tous les nouveaux votes/users garantiront leurs champs requis. Le client pourra ensuite faire confiance aux données reçues.

1. **S3** — Renforcer `validateVote` : refuser si `userName` est vide ou ne contient que des espaces.
   - Fichier : `src/resolvers/mutations.ts`
2. **S2** — Ne publier `EVENT_VOTEADDED` que sur succès.
   - Fichier : `src/resolvers/mutations.ts:280`
3. **S1** — Implémenter vraiment `getCampaignsVoted`.
   - Fichier : `src/resolvers/queries.ts:141`
4. **S5** — Null-check sur `getUserByEmail` / `getUserByUserName` / `getUsers` avant spread.
   - Fichier : `src/resolvers/queries.ts`
5. **S6** — `getVoteById` throw si non trouvé.
   - Fichier : `src/datasourcesredis.ts:551`
6. **S4** — Remplacer `catch + return []` par `throw new GraphQLError(...)` dans `getCampaigns`.
   - Fichier : `src/datasourcesmongo.ts`
7. **S7** — Validation `decodedToken.uid` dans le contexte Apollo.
   - Fichier : `src/index.ts`

### Phase 2 — Client (consommation)

8. **C5, C6** — Bloquer les mutations/queries qui partent avec des champs vides (`HomeScreen`, `CampaignsScreen`). Redirection auth si l'utilisateur Firebase n'a pas tout.
9. **C4** — Refactor `AddVoteScreen` : exiger un `displayName` Firebase complet avant de permettre le vote.
10. **C1, C2, C3** — Arrêter de "nettoyer" les `userName` en `null` dans les caches Apollo. Faire confiance au serveur. Pour les blind votes, le serveur devrait retourner explicitement quelque chose comme `userName: "[blind]"` ou ajouter un flag séparé.
11. **C7** — `AuthorLabel` doit afficher un placeholder visible plutôt que de disparaître.

### Phase 3 — Décision sur les blind votes (à clarifier en route)

Le pattern actuel mélange "donnée manquante" et "donnée volontairement cachée (blind vote)". Deux options à valider quand on y arrivera :

- **Option A :** Le serveur renvoie un userName "synthétique" (`"[Vote anonyme]"`) pour les blind votes
- **Option B :** Schema GraphQL avec champ `isBlind: Boolean!` séparé, et userName toujours présent (mais peut être ignoré côté UI selon le flag)

---

## Fichiers Critiques à Modifier

**Serveur :**
- `src/resolvers/mutations.ts` (validateVote, addVote pubsub)
- `src/resolvers/queries.ts` (getCampaignsVoted, getUserBy*, getUsers)
- `src/datasourcesmongo.ts` (getCampaigns + variants)
- `src/datasourcesredis.ts` (getVoteById)
- `src/index.ts` (Firebase context)

**Client :**
- `screens/DashboardScreens/PollOptionDetailsScreen.tsx`
- `screens/DashboardScreens/VoteDetailsScreen.tsx`
- `screens/DashboardScreens/AddVoteScreen.tsx`
- `screens/DashboardScreens/HomeScreen.tsx`
- `screens/DashboardScreens/CampaignsScreen.tsx`
- `components/AuthorLabel.tsx`

---

## Vérification (end-to-end)

Après chaque phase :

1. **Serveur :** `npm run watch` (déjà actif via nodemon) — vérifier que la compilation passe
2. **Test manuel des cas d'erreur :**
   - Tenter un `addVote` avec `userName: ""` → doit retourner `GraphQLError`
   - Tenter `getVoteById` avec un ID inexistant → doit retourner erreur, pas null
   - Tenter `getUserByEmail` avec email inexistant → doit retourner erreur structurée
3. **Client :** Recharger les écrans Home, Campaigns, PollOption, VoteDetails — vérifier qu'aucun nom vide n'apparaît
4. **Test blind vote :** Créer une campagne `blindVote: true`, voter, vérifier l'affichage côté UI

---

## Hors-Scope

- Migration des données legacy existantes (votes/users avec champs vides en base)
- Refonte complète du système de blind votes (à discuter en Phase 3)
- Validation côté Firebase (`displayName` requis à la création de compte) — peut nécessiter un trigger Firebase Auth
- Findings de severity LOW (assertions `!`, fallbacks `?` dans les avatars, etc.)
