# web-pressupostos

Web per gestionar uns pressupostos personals a partir d'exportacions bancàries (Revolut, de moment) i dades introduïdes a mà.

## Posar-la en marxa

```bash
npm install
npm run dev        # http://localhost:5173
npm run test:run   # tests
npm run build      # typecheck + build de producció
npm run test:rules # regles de Firestore a l'emulador
npm run deploy     # build + Hosting + regles
```

On es guarden les dades depèn de la configuració:

| Mode | Com | Dades |
|---|---|---|
| Local | `npm run dev` sense `.env.local` | localStorage del navegador |
| Emulador | `npm run emulators` + `npm run dev:emu` | Auth i Firestore locals (es perden en aturar) |
| Firebase | `npm run dev` amb `.env.local` / producció | Firestore, amb login de Google |

A *Configuració* sempre pots descarregar una còpia en JSON. Si el navegador té dades de la versió local, també hi surt un botó per copiar-les al núvol.

## Firebase

Tot cap al pla gratuït (Spark): Hosting + Auth + Firestore, sense backend propi.

### Instal·lar dependències

```bash
npm install firebase
npm install -D firebase-tools @firebase/rules-unit-testing
```

Els emuladors (i `npm run test:rules`) necessiten **Java 21+** instal·lat.

### Crear el projecte (un sol cop)

1. [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (pots desactivar Analytics). Queda al pla Spark: no demana targeta.
2. *Build → Authentication → Get started → Sign-in method → Google* → activar.
3. *Build → Firestore Database → Create database* → mode **producció**, ubicació `europe-southwest1` (Madrid) o `eur3`. La ubicació no es pot canviar després.
4. *Project settings → Your apps → Web (</>)* → registrar l'app (no cal marcar Hosting aquí). Copia els valors a `.env.local` (plantilla a `.env.example`).
5. A `.env.local` posa també `FIREBASE_ACCOUNT` (compte amb què es desplega) i `ALLOWED_EMAILS` (llista blanca, separada per comes). Cap correu queda al repo.
6. `npx firebase login:add` amb el compte personal (si ja tens el de feina connectat) i `npm run deploy`. L'app queda a `https://<project-id>.web.app`.

`npm run deploy`, `deploy:rules`, `emulators` i `test:rules` passen per `scripts/firebase.mjs`, que:
- afegeix `--project` i `--account` de `.env.local` (o el projecte `demo-pressupostos` per als emuladors), així mai es desplega amb el compte o projecte de feina;
- comprova que `.firebaserc` i `.env.local` apuntin al mateix projecte i ignora `GOOGLE_APPLICATION_CREDENTIALS`/`FIREBASE_TOKEN` heretats;
- genera `firestore.rules` (ignorat per git) a partir de `firestore.rules.template` amb `ALLOWED_EMAILS`.

Per a altres comandes: `npm run firebase -- <comanda>` (p.ex. `npm run firebase -- hosting:channel:deploy prova`).

Per desenvolupar amb el projecte real en local, `localhost` ja és a *Authentication → Settings → Authorized domains* per defecte.

### Desplegament automàtic (GitHub Actions)

`.github/workflows/ci.yml`: a cada PR passa els tests (unitaris, regles a l'emulador i typecheck); a cada push a `main`, a més, fa `npm run deploy` (Hosting + regles). També es pot llançar a mà des de la pestanya *Actions*.

Configuració (un sol cop):

1. **Compte de servei**: [Google Cloud Console → IAM → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=web-pressupostos) → *Create service account* (`github-deploy`) amb els rols **Firebase Admin** i **Service Usage Consumer**. Després → *Keys → Add key → JSON*. Es descarrega un fitxer: és una credencial, no el desis al repo.
2. **GitHub → Settings → Secrets and variables → Actions**:
   - *Secrets*: `FIREBASE_SERVICE_ACCOUNT` = contingut sencer del JSON; `ALLOWED_EMAILS` = el mateix que a `.env.local`.
   - *Variables*: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (els mateixos valors que `.env.local`).
3. (Opcional) *Settings → Environments → production*: pots exigir aprovació manual abans de cada desplegament.
4. Esborra el JSON descarregat de l'ordinador un cop copiat a GitHub.

Si un desplegament falla per permisos, el missatge diu quin permís falta: afegeix el rol corresponent al compte de servei.

### Model de dades

```
users/{uid}                     { email, defaultBudgetId }
budgets/{budgetId}              { name, members: { uid: owner|editor|viewer }, settings, seeded }
budgets/{budgetId}/accounts|transactions|categories|rules|valuations/{id}
```

- El primer login crea `budgets/personal-{uid}` (id determinista: reintentar és idempotent) amb categories i regles per defecte.
- `CachedBudgetRepository` llegeix tot el pressupost **una vegada per sessió** i després només escriu els documents que han canviat (batches de 450). Així el consum queda lluny de la quota gratuïta (50k lectures i 20k escriptures al dia).
- Si obres l'app en dos dispositius alhora, l'altre no veu els canvis fins que recarregues.

### Seguretat

- Llista blanca de correus (verificats): `ALLOWED_EMAILS` a `.env.local` → `firestore.rules` generat. Qui no hi és pot fer login però no llegeix ni escriu res.
- Només els membres d'un pressupost el poden llegir; `owner`/`editor` escriure-hi; ningú pot canviar `members` des del client (encara no hi ha UI per compartir).
- Tests de les regles contra l'emulador: `npm run test:rules`. Fan servir la plantilla real amb una llista blanca de proves.

### Primer ús

1. **Configuració**: posa el teu nom tal com surt als extractes i el text de la nòmina. Això activa les regles de traspassos propis, del compte conjunt i de la nòmina.
2. **Importar**: puja l'export CSV de Revolut ("Account statement", tots els productes). Veuràs una previsualització i si els saldos quadren abans de confirmar.
3. **Comptes**: posa la TAE i/o valoracions als comptes que l'export no inclou (Flexible Cash Funds, guardioles migrades, broker...). Crea comptes manuals (efectiu, inversions).
4. **Moviments**: categoritza. Si canvies la categoria d'un moviment importat, es crea una regla i s'aplica als moviments amb la mateixa descripció.

## Arquitectura

```
src/
  domain/          Lògica pura, sense dependències (fàcil de testejar)
    types.ts         Account, Transaction, Category, Valuation...
    classification.ts  Motor de regles (les regles són dades, editables des de l'app)
    balances.ts      Saldo per moviments o per valoracions (+ interès estimat)
    interest.ts      TAE/TIN, previsions, temps per arribar a un objectiu, rendiment real
    investments.ts   Aportat vs valor → guany
    summary.ts       Filtres i resums (ingressos, despesa real, estalvi, per categoria)
    transactions.ts  Alta i edició manual
  importers/       Port BankImporter + un adaptador per banc
    revolut/         Parser, validació de saldos, id estable per fila, regles per defecte
  application/     Casos d'ús: planificar importació, aparellar traspassos, reaplicar regles
    ports.ts         BudgetRepository (persistència)
  infrastructure/  Adaptadors: localStorage, CachedBudgetRepository, firebase/ (app, sessió, Firestore)
  ui/              React
tests/             Vitest (fixture anonimitzat a tests/fixtures); tests/rules = regles a l'emulador
```

### Decisions clau

- **Imports en cèntims enters** (mai floats).
- **Tipus de moviment**: `expense`, `income`, `transfer`, `interest`, `refund`, `reimbursement`, `adjustment`. Els traspassos no compten com a ingrés ni despesa; les devolucions i reemborsaments (p.ex. Bizums d'amics) **resten** de la despesa de la seva categoria.
- **Classificar per descripció, no pel camp `Type`** del banc (a Revolut, `Transfer` inclou impostos, assegurances i Bizums).
- **Id determinista per fila** (hash de compte + data + descripció + import + comissió + saldo): reimportar no duplica.
- **Validació**: per a cada producte, `saldo anterior + Amount − Fee = Balance`. Si no quadra, avisa.
- **Comptes que l'export no inclou** (Flexible Cash Funds, estalvi migrat): la regla crea la pota contrària del traspàs en un compte en mode `valuations`. El valor és l'última valoració manual + aportacions posteriors (+ interès estimat amb la TAE).
- **Compte conjunt** en un altre banc: es tracta com a despesa compartida (categoria *Despeses compartides*).
- **Tot penja d'un pressupost** (`budgetId`), no de l'usuari: preparat per a pressupostos compartits.

## Privacitat

Els exports reals **no s'han de pujar mai al repo** (contenen dades de tercers). Desa'ls a `private/` (ignorat per git). Per provar-los:

```bash
REVOLUT_CSV=private/export.csv OWNER_NAME="NOM COGNOMS" EMPLOYER="EMPRESA" npm run test:run
```

## Properes passes

- [x] Firebase: Auth (Google) + Firestore (`budgets/{budgetId}/...`) + regles de seguretat amb tests a l'emulador + Hosting
- [x] Desplegament automàtic amb GitHub Actions
- [ ] Vista de gràfiques (per categoria, per mes, evolució del patrimoni)
- [ ] Vista d'objectius (import, data, comptes vinculats, progrés i previsió)
- [ ] Inversions en borsa: posicions (ticker, quantitat, preu) i, opcionalment, cotitzacions via API
- [ ] Editor de categories
