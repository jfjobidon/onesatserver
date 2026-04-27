# Comment ajouter ou enlever un champ dans un document MongoDB

> Guide étape par étape pour modifier un modèle Prisma (ex : `Campaign`, `Poll`, `User`) et propager le changement à travers toute la stack : Prisma → GraphQL → resolvers → datasources → client.

---

## Vue d'ensemble du flux

```
┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
│ prisma/schema.prisma │ ──> │  schema.graphql      │ ──> │ src/__generated__/       │
│  (source de vérité  │     │  (API exposée au     │     │   resolvers-types.ts     │
│   MongoDB)          │     │   client)            │     │  (auto-généré)           │
└─────────────────────┘     └──────────────────────┘     └──────────────────────────┘
         │                            │                            │
         ▼                            ▼                            ▼
┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────────────┐
│  npm run prisma     │     │  npm run generate    │     │  Resolvers + DataSources │
│  (Prisma Client)    │     │  (GraphQL types)     │     │  (logique métier)        │
└─────────────────────┘     └──────────────────────┘     └──────────────────────────┘
                                                                     │
                                                                     ▼
                                                         ┌──────────────────────────┐
                                                         │  Client (queries +       │
                                                         │  mutations + UI)         │
                                                         └──────────────────────────┘
```

**Règle d'or :** modifier le schema Prisma en premier, puis remonter vers le client. Toujours régénérer les types après chaque changement de schema.

---

## AJOUTER un champ

Exemple : ajouter un champ `imageUrl: String?` (optionnel) au modèle `Campaign`.

### 1. Modifier le schema Prisma

Fichier : [prisma/schema.prisma](../prisma/schema.prisma)

```prisma
model Campaign {
  id                  String   @id @default(auto()) @map("_id") @db.ObjectId
  // ... autres champs ...
  status              String   @default("draft")
  imageUrl            String?  // ← NOUVEAU CHAMP (optionnel)
  polls               Poll[]
}
```

**Choix important :**
- `String` (sans `?`) = requis → tous les nouveaux documents DOIVENT avoir le champ. Risque : casse les documents existants en MongoDB.
- `String?` = optionnel → nullable, plus sûr pour ajouter à un modèle existant.
- `String  @default("...")` = requis avec valeur par défaut (le moins risqué).

**Note MongoDB :** contrairement à SQL, MongoDB n'a pas de "migration" automatique. Les documents existants ne sont **pas** mis à jour — ils restent sans le champ. Prisma le traite comme `null` à la lecture.

### 2. Régénérer le client Prisma

```bash
npm run prisma
```

Cela régénère `node_modules/@prisma/client` avec les nouveaux types TypeScript.

### 3. Ajouter le champ au schema GraphQL

Fichier : [schema.graphql](../schema.graphql)

```graphql
type Campaign {
  id: String
  authorId: String
  # ... autres champs ...
  status: String
  imageUrl: String       # ← NOUVEAU CHAMP (nullable)
  # ou
  # imageUrl: String!    # ← non-nullable (rejette si manquant)
}

type CampaignAll {
  # même chose ici si on veut le champ aussi dans CampaignAll
  imageUrl: String
}
```

**Si le champ est aussi en input (création/modification) :**

```graphql
input CampaignInput {
  title: String
  description: String
  # ... autres champs ...
  imageUrl: String       # ← NOUVEAU
}
```

### 4. Régénérer les types GraphQL

```bash
npm run generate
```

Cela met à jour [src/__generated__/resolvers-types.ts](../src/__generated__/resolvers-types.ts) avec les nouveaux types `Campaign`, `CampaignInput`, etc.

> **Note** : si nodemon + watcher tournent (`npm run watch`), la regénération est automatique à chaque sauvegarde de `schema.graphql` ou `schema.prisma`.

### 5. Mettre à jour les datasources

Fichier : [src/datasourcesmongo.ts](../src/datasourcesmongo.ts)

Si la création doit accepter ce champ, modifier `createCampaign()` :

```typescript
async createCampaign(campaignInput: CampaignInput): Promise<CampaignMutationResponse> {
  // ...
  const newCampaign = await prisma.campaign.create({
    data: {
      title: campaignInput.title,
      description: campaignInput.description,
      // ... autres champs ...
      imageUrl: campaignInput.imageUrl,  // ← NOUVEAU
      // ...
    }
  })
}
```

Si le champ doit être retourné dans les queries existantes, vérifier que `getCampaign()` et `getCampaignAll()` retournent bien le champ :

```typescript
async getCampaignAll(campaignId: string, viewerUid?: string): Promise<CampaignAll | null> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
  // ... 
  return {
    ...campaign,           // ← le spread inclut automatiquement imageUrl
    pollsAll: polls,
    sats, votes, views
  }
}
```

Le spread `...campaign` inclut automatiquement le nouveau champ — pas besoin de l'ajouter manuellement.

### 6. Mettre à jour le client (queries GraphQL)

Pour chaque écran qui a besoin du nouveau champ, ajouter dans la query :

```typescript
// onesatclient/screens/DashboardScreens/CampaignDetailsScreen.tsx
const GET_CAMPAIGN_DETAILS = gql`
  query GetCampaign($campaignId: String) {
    getCampaign(id: $campaignId) {
      id
      title
      description
      imageUrl    // ← NOUVEAU
      # ...
    }
  }
`
```

Puis utiliser dans le JSX :

```tsx
{campaign.imageUrl && <Image source={{ uri: campaign.imageUrl }} />}
```

### 7. Vérifier la compilation

Côté serveur :
```bash
npx tsc --noEmit
```

Côté client : vérifier qu'aucune erreur TS ou Apollo n'apparaît au runtime.

---

## ENLEVER un champ

Exemple : supprimer le champ `message: String?` du modèle `Campaign`.

### Ordre inversé : commencer par le client

Sinon, le client va demander un champ qui n'existe plus et provoquer des erreurs GraphQL.

### 1. Retirer toutes les références côté client

Chercher toutes les occurrences :

```bash
grep -rn "message" /Users/jfjobidon/Desktop/redshift.nosync/onesatonevote/onesatclient/screens
```

Pour chaque query qui demande `message`, le retirer :

```typescript
const GET_CAMPAIGN_DETAILS = gql`
  query GetCampaign($campaignId: String) {
    getCampaign(id: $campaignId) {
      id
      title
      description
      // message    ← SUPPRIMER
    }
  }
`
```

Retirer aussi les usages dans le JSX (`{campaign.message}`, etc.).

### 2. Retirer du schema GraphQL

Fichier : [schema.graphql](../schema.graphql)

```graphql
type Campaign {
  id: String
  title: String
  description: String
  # message: String   ← SUPPRIMER
}

type CampaignAll {
  # message: String   ← SUPPRIMER
}

input CampaignInput {
  # message: String   ← SUPPRIMER si présent
}
```

### 3. Régénérer les types GraphQL

```bash
npm run generate
```

### 4. Retirer des datasources et resolvers

Fichier : [src/datasourcesmongo.ts](../src/datasourcesmongo.ts)

Chercher les usages explicites :

```bash
grep -n "message" src/datasourcesmongo.ts src/resolvers/*.ts
```

Retirer le champ des `data: { ... }` dans les `prisma.campaign.create({ ... })`, des destructurings, etc. Le spread `...campaign` continuera à inclure le champ tant qu'il existe en Prisma — c'est l'étape suivante qui le supprime.

### 5. Retirer du schema Prisma

Fichier : [prisma/schema.prisma](../prisma/schema.prisma)

```prisma
model Campaign {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  title       String
  description String
  // message  String?   ← SUPPRIMER
}
```

### 6. Régénérer Prisma Client

```bash
npm run prisma
```

### 7. Nettoyer MongoDB (optionnel)

**Important :** retirer un champ de Prisma ne le supprime PAS des documents existants en MongoDB. Le champ reste en base mais Prisma l'ignore.

Pour nettoyer la base, deux options :

**Option A — Laisser tomber (recommandé pour dev)** : le champ reste en base mais n'est plus exposé. Pas de problème fonctionnel.

**Option B — Script de nettoyage** : utiliser `mongosh` ou un script Node :

```javascript
// dans un script ou via mongosh
db.Campaign.updateMany({}, { $unset: { message: "" } })
```

### 8. Vérifier la compilation

```bash
npx tsc --noEmit
```

S'assurer qu'aucune erreur "Property 'message' does not exist" n'apparaît.

---

## Récapitulatif visuel

| Action | Ordre des étapes | Pourquoi |
|---|---|---|
| **Ajouter** | Prisma → GraphQL → resolvers/datasources → client | Le champ doit exister en base avant que le client puisse le demander |
| **Enlever** | Client → GraphQL → resolvers/datasources → Prisma | Le client doit cesser de demander le champ avant qu'il disparaisse du schema |

---

## Pièges fréquents

### 1. Oublier de régénérer
Après modification de `schema.prisma` ou `schema.graphql`, **toujours** lancer `npm run prisma` ou `npm run generate`. Sans ça, TypeScript continue d'utiliser les anciens types et tu auras des erreurs incompréhensibles.

> Si `npm run watch` tourne, c'est automatique sur sauvegarde.

### 2. Ajouter un champ requis sans default
Si tu marques un champ `String` (non-nullable) sans `@default(...)`, tous les documents existants en MongoDB n'auront pas ce champ et Prisma plantera à la lecture (`Field does not exist on enclosing type`).

**Solution :** soit utiliser `String?` (optionnel), soit `String @default("...")`.

### 3. Différence Prisma vs GraphQL nullable
Prisma : `String?` = nullable, `String` = requis.
GraphQL : `String` = nullable, `String!` = requis.

**Attention à l'inversion** : un champ `String` en GraphQL est nullable, donc il faut un check côté client.

### 4. Cache Apollo qui garde l'ancien shape
Après avoir modifié un type GraphQL, le cache Apollo côté client peut garder l'ancien format. En dev, faire un hard reload de l'app. En production, considérer un changement de version de l'API.

### 5. MongoDB vs SQL
Pas de `prisma migrate` pour MongoDB. Le schema Prisma décrit ce que l'application **attend** ; les documents existants ne sont jamais altérés automatiquement. Pour des migrations de données, écrire un script Node ad hoc.

---

## Commandes de référence

```bash
# Après modification de prisma/schema.prisma
npm run prisma                # Régénère @prisma/client

# Après modification de schema.graphql
npm run generate              # Régénère src/__generated__/resolvers-types.ts

# Tout en même temps
npm run pgc                   # prisma generate + codegen + tsc

# Vérifier la compilation TypeScript sans build
npx tsc --noEmit

# Mode développement (regénère automatiquement)
npm run watch
```

---

## Fichiers impliqués

| Fichier | Rôle |
|---|---|
| [prisma/schema.prisma](../prisma/schema.prisma) | Source de vérité MongoDB |
| [schema.graphql](../schema.graphql) | API exposée au client |
| [src/__generated__/resolvers-types.ts](../src/__generated__/resolvers-types.ts) | Types TS auto-générés (ne pas éditer) |
| [src/datasourcesmongo.ts](../src/datasourcesmongo.ts) | Logique d'accès MongoDB via Prisma |
| [src/resolvers/queries.ts](../src/resolvers/queries.ts) | Resolvers de queries GraphQL |
| [src/resolvers/mutations.ts](../src/resolvers/mutations.ts) | Resolvers de mutations |
| `onesatclient/screens/**/*.tsx` | Queries Apollo + UI |
