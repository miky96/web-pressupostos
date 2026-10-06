# web-pressupostos

Web per gestionar uns pressupostos personals a partir d'exportacions bancàries (Revolut, de moment) i dades introduïdes a mà.

## Posar-la en marxa

```bash
npm install
npm run dev        # http://localhost:5173
npm run test:run   # tests
npm run build      # typecheck + build de producció
```

De moment les dades es guarden **només al navegador** (localStorage). A *Configuració* pots descarregar-ne una còpia en JSON. El pas següent és connectar Firebase (Auth + Firestore) implementant el mateix port de repositori.

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
  infrastructure/  Adaptadors de persistència (ara localStorage; després Firestore)
  ui/              React
tests/             Vitest (fixture anonimitzat a tests/fixtures)
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

- [ ] Firebase: Auth (Google) + Firestore (`budgets/{budgetId}/...`) + regles de seguretat amb tests a l'emulador + Hosting
- [ ] Vista de gràfiques (per categoria, per mes, evolució del patrimoni)
- [ ] Vista d'objectius (import, data, comptes vinculats, progrés i previsió)
- [ ] Inversions en borsa: posicions (ticker, quantitat, preu) i, opcionalment, cotitzacions via API
- [ ] Editor de categories
