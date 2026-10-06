import { escapeRegex, type Rule } from '../../domain/classification';

/**
 * Regles per defecte per a Revolut. Criteri: classificar per DESCRIPCIÓ, no pel camp Type
 * (Type=Transfer inclou tant traspassos propis com impostos, assegurances o Bizums).
 * Prioritats: 1-99 tipus de moviment, 100+ categories per comerç.
 */
export function revolutDefaultRules({
  ownerName,
  employerPattern,
}: { ownerName?: string; employerPattern?: string } = {}): Rule[] {
  const rules: Rule[] = [];
  const add = (id: string, name: string, priority: number, when: Rule['when'], then: Rule['then']) =>
    rules.push({ id: `revolut-${id}`, name, priority, when, then, builtIn: true });

  if (employerPattern?.trim()) {
    add('salary', 'Nòmina', 5, { descriptionContains: employerPattern.trim(), direction: 'in' },
      { kind: 'income', categoryId: 'nomina', needsReview: false });
  }

  // --- Traspassos entre comptes propis -------------------------------------------------
  add('flexible-cash-funds', 'Traspàs a/des de Flexible Cash Funds', 10,
    { descriptionMatches: '^(To|From) (EUR )?Flexible Cash Funds' },
    {
      kind: 'transfer',
      mirrorTo: {
        accountKey: 'revolut:flexible-cash-funds:EUR',
        suggestedName: 'Flexible Cash Funds',
        suggestedType: 'savings',
      },
    });
  add('topup', 'Recàrrega des d\'un altre banc propi', 11,
    { descriptionMatches: '^(Top-up by|Google Pay deposit by|Apple Pay deposit by|Open banking deposit)' },
    { kind: 'transfer' });
  // Guardioles d'estalvi. Si l'export inclou el producte (Deposit), les dues potes s'aparellen;
  // si no (p.ex. l'estalvi migrat a un banc soci), es crea la pota al compte "Revolut Savings".
  const savingsPocket = { accountKey: 'revolut:savings:EUR', suggestedName: 'Revolut Savings', suggestedType: 'savings' as const };
  add('savings', 'Traspàs a/des d\'una guardiola d\'estalvi', 12,
    { descriptionMatches: '^(To|From) (EUR )?Savings |^SavingsAccount migration' },
    { kind: 'transfer', mirrorTo: savingsPocket });
  add('closing', 'Tancament de producte (import 0)', 13,
    { descriptionMatches: '^Closing transaction$' },
    { kind: 'transfer', hidden: true });

  if (ownerName?.trim()) {
    const owner = escapeRegex(ownerName.trim());
    // Compte conjunt en un altre banc: des del pressupost personal, és despesa compartida.
    add('joint-out', 'Aportació al compte conjunt', 14,
      { descriptionMatches: `^Transfer to .+&\\s*${owner}$`, direction: 'out' },
      { kind: 'expense', categoryId: 'despeses-compartides' });
    add('joint-in', 'Retorn del compte conjunt', 15,
      { descriptionMatches: `^Transfer from .+&\\s*${owner}$`, direction: 'in' },
      { kind: 'reimbursement', categoryId: 'despeses-compartides' });
    add('own-transfer', 'Traspàs des d\'un compte propi', 16,
      { descriptionMatches: `^(Payment|Transfer) (from|to) ${owner}$` },
      { kind: 'transfer' });
  }

  // --- Interessos, devolucions, reemborsaments -----------------------------------------
  add('interest', 'Interessos', 20, { bankTypes: ['Interest'] }, { kind: 'interest', categoryId: 'interessos' });
  add('card-refund', 'Devolució de targeta', 21, { bankTypes: ['Card Refund', 'Charge Refund'] }, { kind: 'refund' });
  add('revert', 'Anul·lació', 22, { descriptionMatches: '^Revert of: ' }, { kind: 'refund' });
  add('return', 'Devolució', 23, { descriptionMatches: '^Return: ' }, { kind: 'refund' });
  add('plan-refund', 'Devolució de pla Revolut', 24, { descriptionMatches: '^Plan termination refund' },
    { kind: 'refund', categoryId: 'comissions' });
  add('bizum-in', 'Bizum rebut (algú et torna diners)', 25, { descriptionMatches: '^Money added via BIZUM' },
    { kind: 'reimbursement' });

  // --- Despeses ---------------------------------------------------------------------------
  add('charge', 'Comissió / quota de pla', 30, { bankTypes: ['Charge'] }, { kind: 'expense', categoryId: 'comissions' });
  add('atm', 'Retirada d\'efectiu', 31, { bankTypes: ['ATM'] }, { kind: 'expense', categoryId: 'efectiu' });
  add('exchange-out', 'Canvi a una altra divisa', 32, { bankTypes: ['Exchange'], direction: 'out' },
    { kind: 'expense', categoryId: 'divises' });
  add('exchange-in', 'Canvi de tornada a EUR', 33, { bankTypes: ['Exchange'], direction: 'in' },
    { kind: 'refund', categoryId: 'divises' });
  add('bizum-out', 'Bizum enviat o compra amb Bizum', 34, { descriptionMatches: '^Bizum (payment to|purchase at):' },
    { kind: 'expense' });
  add('card', 'Pagament amb targeta', 40, { bankTypes: ['Card Payment', 'Rev Payment'], direction: 'out' },
    { kind: 'expense' });
  add('transfer-out', 'Transferència / rebut sortint', 41, { bankTypes: ['Transfer'], direction: 'out' },
    { kind: 'expense' });

  // --- Entrades de tercers: probablement algú et torna diners; cal revisar ------------------
  add('third-party-in', 'Pagament rebut d\'un tercer', 50, { descriptionMatches: '^(Payment|Transfer) from ', direction: 'in' },
    { kind: 'reimbursement', needsReview: true });

  // --- Categories per comerç (editables) --------------------------------------------------
  const cat = (id: string, priority: number, pattern: string, categoryId: string) =>
    add(`cat-${id}`, `Categoria: ${id}`, priority, { descriptionMatches: pattern }, { categoryId });
  cat('delivery', 100, 'uber eats|glovo|just eat|deliveroo', 'restaurants');
  cat('supermercat', 101, 'mercadona|caprabo|aldi|lidl|bon ?[àa]rea|ametller|spar\\b|\\bconsum\\b|carrefour|condis|esclat|bonpreu', 'supermercat');
  cat('transport', 102, '\\buber\\b|cabify|\\bbolt\\b|ferrocarrils|\\bfgc\\b|renfe|\\bmta\\b|transport for london|\\btmb\\b|foztrans|sptrans|busbud|12go|\\bgrab\\b', 'transport');
  cat('subscripcions', 103, 'google one|google play|youtube|apple|soundcloud|crunchyroll|netflix|spotify|hbo|disney|prime video', 'subscripcions');
  cat('compres', 104, 'amazon|aliexpress|alipay|decathlon|tiendanimal', 'compres');
  cat('cotxe', 105, 'repsol|cepsa|galp|\\bitv\\b|wesmartpark|parking', 'cotxe');
  cat('salut', 106, 'farmac|fisioterap|pharma|drogaria|optica|òptica', 'salut');
  cat('subministraments', 107, 'parlem|movistar|vodafone|orange|digi\\b|1global|endesa|iberdrola|naturgy|aig[üu]es', 'subministraments');
  cat('assegurances', 108, 'linea directa|l[íi]nea directa|mapfre|\\baxa\\b|mutua|sanitas|adeslas', 'assegurances');
  cat('impostos', 109, 'agencia tributaria|\\baeat\\b|ajuntament|ayto', 'impostos');
  cat('oci', 110, 'ticketmaster|\\bcine|yelmo|portaventura|codetickets|sympla|idasfest|entradas', 'oci');
  cat('restaurants', 111, 'restaura|\\bbar\\b|caf[eé]|pizza|mcdonald|kfc|burger|tapas|lanchonete|boteco|\\bforn\\b|fleca|pastisser', 'restaurants');

  return rules;
}
