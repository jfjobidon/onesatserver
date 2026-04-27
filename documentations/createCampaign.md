# `createCampaign` — Documentation technique

> Création d'une campagne de vote dans OneSatOneVote. Couvre le flux complet du formulaire client jusqu'à l'insertion MongoDB, avec les garanties d'authentification Firebase.

---

## Vue d'ensemble du flux

```
┌────────────────────┐
│ CreateCampaignScreen│  React Native — formulaire utilisateur
│  (client)          │
└─────────┬──────────┘
          │ onPressCreate(formData)
          │ - validation locale (UX)
          │ - Apollo `mutateCampaign(...)`
          ▼
┌────────────────────────────────────┐
│ Apollo HttpLink + customFetch       │  config/ApolloConfig.ts
│  • Ajoute auto le header           │
│    Authorization: Bearer <token>   │
└─────────┬──────────────────────────┘
          │ HTTP POST → http://localhost:40000/graphql
          ▼
┌────────────────────────────────────┐
│ Express + Apollo Server (serveur)   │  src/index.ts
│  context: verifyToken(req.headers)  │  → context.userId = uid Firebase vérifié
└─────────┬──────────────────────────┘
          ▼
┌────────────────────────────────────┐
│ Resolver `createCampaign`           │  src/resolvers/mutations.ts
│  • Vérifie context.userId          │
│  • Délègue au datasource           │
└─────────┬──────────────────────────┘
          ▼
┌────────────────────────────────────┐
│ DataSourcesMongo.createCampaign     │  src/datasourcesmongo.ts
│  • Validation métier               │
│  • prisma.user.update(...)         │
└─────────┬──────────────────────────┘
          ▼
       MongoDB Atlas
```

---

## 1. Côté client — `CreateCampaignScreen.tsx`

**Fichier :** `onesatclient/screens/CreateCampaignScreens/CreateCampaignScreen.tsx`

### Définition de la mutation

```typescript
const CREATE_CAMPAIGN = gql`
  mutation CreateCampaign($campaignInput: CampaignInput) {
    createCampaign(campaignInput: $campaignInput) {
      code
      success
      message
      campaign {
        id, authorId, title, description,
        minSatPerVote, maxSatPerVote, suggestedSatPerVote,
        blindAmount, blindRank, blindVote, allowMultipleVotes,
        creationDate, startingDate, endingDate, updatedDate,
        paused, sats, views, votes
      }
    }
  }
`
```

### Hook de mutation

```typescript
const [mutateCampaign, { loading }] = useMutation(CREATE_CAMPAIGN, {
  onCompleted: (data) => {
    const res = data?.createCampaign
    if (res?.success) {
      // navigation vers la nouvelle campagne
    } else {
      alert(res?.message)
    }
  },
  onError: (error) => console.error('CREATE_CAMPAIGN error:', error),
})
```

### Soumission du formulaire (`onPressCreate`)

1. Validation locale (UX rapide) :
   - Sat bounds : `min ≤ suggested ≤ max`
   - Date : `startingDate ≥ now`, `endingDate > startingDate`
2. Construction de `campaignInput` **sans `authorId`** (le serveur le détermine)
3. Appel de `mutateCampaign({ variables: { campaignInput } })`

### Authentification — automatique

Aucune gestion manuelle du token dans ce composant. Le header est ajouté pour **toutes** les requêtes par `customFetch` dans [config/ApolloConfig.ts](../../../onesatclient/config/ApolloConfig.ts) :

```typescript
const customFetch = async (uri, options) => {
  const user = FIREBASE_AUTH.currentUser
  if (user) {
    const token = await user.getIdToken()
    options.headers = {
      ...options.headers,
      authorization: `Bearer ${token}`,
    }
  }
  return fetch(uri, options)
}
```

---

## 2. Couche de transport — Apollo + Express

### Vérification du token

À l'arrivée de chaque requête HTTP, le code dans [src/index.ts](../src/index.ts) construit le `context` Apollo :

```typescript
context: async ({ req }) => {
  const decodedToken = await verifyToken(req.headers.authorization)
  if (!decodedToken) {
    return { isAuthenticated: false }
  }
  return {
    userId: decodedToken.uid,
    roles: decodedToken.roles ?? [],
    isAuthenticated: true,
    isAppToken: decodedToken.isAppToken ?? false,
  }
}
```

`verifyToken()` (dans [src/firebase.ts](../src/firebase.ts)) appelle `firebase-admin` pour valider la signature cryptographique du token et en extraire le `uid`. Si la signature est invalide ou le token expiré, `decodedToken === null` → `context.isAuthenticated = false`.

### Garantie

À ce stade, `context.userId` est **l'identité prouvée** de l'utilisateur. Le client ne peut pas la falsifier — il transmet seulement le token signé par Google.

---

## 3. Resolver — `src/resolvers/mutations.ts`

```typescript
createCampaign: async (_, { campaignInput }, context) => {
  if (!context.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
    })
  }
  if (!campaignInput) {
    throw new GraphQLError('campaignInput is required', {
      extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
    })
  }
  let campaign = await dataSourcesMongo.createCampaign(campaignInput, context.userId)
  return {...campaign}
}
```

### Garde-fous

| Cas | Réponse |
|---|---|
| Pas de header `Authorization` ou token invalide | `GraphQLError` 401 `UNAUTHENTICATED` |
| `campaignInput` manquant ou null | `GraphQLError` 400 `BAD_USER_INPUT` |
| Validation métier échoue (datasource) | `{ code: "400", success: false, message: "...", campaign: null }` |

### Pourquoi 2 styles d'erreur ?

- **Throw `GraphQLError`** : erreurs techniques (auth, input absent) qui ne sont pas censées arriver dans un flux client normal.
- **Return `{ success: false, message }`** : erreurs métier (titre trop court, dates invalides) attendues et affichables à l'utilisateur.

### Important : pas d'`authorId` dans `CampaignInput`

Le schema GraphQL ([schema.graphql](../schema.graphql)) ne permet plus au client d'envoyer `authorId`. Si le client tente, GraphQL rejette la requête avant même d'atteindre le resolver. L'`authorId` est **toujours** `context.userId`.

---

## 4. DataSource — `src/datasourcesmongo.ts`

```typescript
async createCampaign(
  campaignInput: CampaignInput,
  authorId: string
): Promise<CampaignMutationResponse>
```

### Étapes (dans l'ordre)

1. **Validation des champs texte**
   - `validateTitle(title)` : longueur min/max
   - `validateDescription(description)` : longueur min/max
   - `normalizeText(...)` : trim + remplacement des espaces multiples

2. **Validation des sats**
   - `validateSatsMin('Minimum', minSatPerVote)`
   - `validateSatsMax('Maximum', maxSatPerVote)`
   - `validateSatsMax('Suggested', suggestedSatPerVote)`
   - Cohérence : `min ≤ max`, `min ≤ suggested ≤ max`

3. **Application des défauts** (depuis `config/default.json`)
   - `minSatPerVoteDefault`, `maxSatPerVoteDefault`, `suggestedSatPerVoteDefault`
   - `isPrivateDefault`, `blindAmountDefault`, `blindRankDefault`, `blindVoteDefault`, `allowMultipleVotesDefault`
   - `campaignPausedDefault` → `paused`
   - `status` initialisé à `"draft"`

4. **Validation des dates**
   - `startingDate ≥ now` (avec tolérance de 60 secondes pour clock skew)
   - `endingDate > startingDate`

5. **Insertion MongoDB via Prisma**
   ```typescript
   prisma.user.update({
     where: { uid: authorId },
     data: {
       campaigns: {
         createMany: { data: [{ ...nouveauCampaign }] }
       }
     }
   })
   ```
   - Le `User` doit déjà exister en MongoDB (via `signup`). Sinon → erreur Prisma `P2025`.
   - Crée le document `Campaign` lié à l'utilisateur via la relation `User → Campaign[]`.

6. **Retour de la réponse**
   - Succès : `{ code: "200", success: true, message: "Campaign created!", campaign: { ... } }`
   - Échec : `{ code: "400" | "500", success: false, message, campaign: null }`

### Aucun écriture Redis

À la création, **aucune** stat Redis n'est initialisée. Les compteurs (`sats`, `votes`, `views`) restent à 0 implicitement et seront créés à la volée lors du premier vote.

---

## 5. Modèle de données

### Schema Prisma — [prisma/schema.prisma](../prisma/schema.prisma)

```prisma
model Campaign {
  id                  String   @id @default(auto()) @map("_id") @db.ObjectId
  author              User     @relation(fields: [authorId], references: [uid])
  authorId            String
  title               String
  description         String
  message             String?
  creationDate        DateTime
  startingDate        DateTime
  endingDate          DateTime
  updatedDate         DateTime
  minSatPerVote       Int
  maxSatPerVote       Int
  suggestedSatPerVote Int
  isPrivate           Boolean  @default(false)
  blindAmount         Boolean
  blindRank           Boolean
  blindVote           Boolean
  allowMultipleVotes  Boolean
  paused              Boolean  @default(false)
  status              String   @default("draft")
  polls               Poll[]
}
```

### Type GraphQL — [schema.graphql](../schema.graphql)

```graphql
input CampaignInput {
  title: String!
  description: String!
  startingDate: DateScalar!
  endingDate: DateScalar!
  minSatPerVote: Int
  maxSatPerVote: Int
  suggestedSatPerVote: Int
  isPrivate: Boolean
  blindAmount: Boolean
  blindRank: Boolean
  blindVote: Boolean
  allowMultipleVotes: Boolean
}

type CampaignMutationResponse {
  code: String!
  success: Boolean!
  message: String!
  campaign: Campaign
}

type Mutation {
  createCampaign(campaignInput: CampaignInput): CampaignMutationResponse
}
```

**À noter** : `authorId` **n'est pas** dans `CampaignInput` (volontaire — sécurité). Il **est** dans le `type Campaign` retourné (lecture).

---

## 6. Test avec Postman

### Headers

```
Content-Type: application/json
Authorization: Bearer <firebase-id-token>
```

### Body

```json
{
  "query": "mutation CreateCampaign($campaignInput: CampaignInput) { createCampaign(campaignInput: $campaignInput) { code success message campaign { id authorId title status } } }",
  "variables": {
    "campaignInput": {
      "title": "Ma Campagne",
      "description": "Description test",
      "startingDate": "2026-05-01T17:00:00.000Z",
      "endingDate": "2026-06-01T17:00:00.000Z",
      "minSatPerVote": 1,
      "maxSatPerVote": 10,
      "suggestedSatPerVote": 5,
      "isPrivate": false,
      "blindAmount": false,
      "blindRank": false,
      "blindVote": false,
      "allowMultipleVotes": false
    }
  }
}
```

### Cas de test

| Test | Résultat attendu |
|---|---|
| Sans header `Authorization` | Erreur GraphQL 401 `UNAUTHENTICATED` |
| Avec token valide, sans `authorId` dans le body | Succès — `authorId` dans la réponse = uid du token |
| Avec `authorId: "fake"` dans le body | Erreur GraphQL : `Field "authorId" is not defined by type "CampaignInput"` |
| Avec `title: ""` | `success: false`, message validation |
| Avec `endingDate < startingDate` | `success: false`, "Ending date must be after starting date" |
| Token valide mais user inexistant en MongoDB | Erreur Prisma `P2025` (pas géré actuellement → throw) |

---

## 7. Sécurité & garanties

| Garantie | Comment |
|---|---|
| **Aucune usurpation d'identité** | `authorId` n'est **pas** acceptable en input ; déterminé par `context.userId` |
| **Aucune création anonyme** | Throw 401 si `context.userId` absent |
| **Validation systématique** | Datasource valide tous les champs avant insertion |
| **Cohérence des dates** | `startingDate ≥ now`, `endingDate > startingDate` |
| **Cohérence des sats** | `min ≤ suggested ≤ max` |
| **Statut initial contrôlé** | `status: "draft"`, `paused: false` (configurable via `config/default.json`) |

---

## 8. Améliorations possibles (TODO)

- **Vérifier l'existence du User en Mongo** avant `prisma.user.update()`. Actuellement `P2025` est levé si manquant → message peu clair pour le client.
- **Auto-créer le User** la première fois que l'utilisateur fait une mutation (lazy signup).
- **Limiter le nombre de campagnes par utilisateur** (anti-spam).
- **Logger l'activité** dans Redis (`activitiesRepository`) pour avoir un historique.
- **Subscriptions** : publier `EVENT_CAMPAIGN_CREATED` pour notifier les abonnés.

---

## Fichiers de référence

| Fichier | Rôle |
|---|---|
| [src/resolvers/mutations.ts](../src/resolvers/mutations.ts) | Resolver GraphQL `createCampaign` |
| [src/datasourcesmongo.ts](../src/datasourcesmongo.ts) | Logique métier + insertion Prisma |
| [src/firebase.ts](../src/firebase.ts) | Vérification du token Firebase |
| [src/index.ts](../src/index.ts) | Construction du `context` Apollo |
| [schema.graphql](../schema.graphql) | Définitions `CampaignInput`, `Campaign`, `Mutation` |
| [prisma/schema.prisma](../prisma/schema.prisma) | Modèle MongoDB `Campaign` |
| [config/default.json](../config/default.json) | Valeurs par défaut (sats, blindAmount, etc.) |
| `onesatclient/screens/CreateCampaignScreens/CreateCampaignScreen.tsx` | Formulaire client + appel mutation |
| `onesatclient/config/ApolloConfig.ts` | `customFetch` qui ajoute le Bearer token |
