import { parseCsv } from './csv';
import { revolutImporter } from './revolut/revolutImporter';
import type { BankImporter, ImportResult } from './types';

/** Per afegir un banc nou: crear un adaptador que implementi BankImporter i afegir-lo aquí. */
export const IMPORTERS: BankImporter[] = [revolutImporter];

export function findImporter(header: string[]): BankImporter | undefined {
  return IMPORTERS.find((imp) => imp.canParse(header));
}

export function importCsv(text: string): { importer: BankImporter; result: ImportResult } {
  const records = parseCsv(text);
  if (records.length < 2) throw new Error('El fitxer és buit o no té moviments');
  const importer = findImporter(records[0]);
  if (!importer) {
    throw new Error(
      `No reconec el format d'aquest fitxer. Bancs suportats: ${IMPORTERS.map((i) => i.label).join(', ')}.`,
    );
  }
  return { importer, result: importer.parse(records) };
}
