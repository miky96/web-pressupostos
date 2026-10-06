import type { Category } from './types';

/** Categories inicials. L'usuari les pot editar; les regles per defecte en fan servir els ids. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'supermercat', name: 'Supermercat', kind: 'expense', color: '#2a9d8f' },
  { id: 'restaurants', name: 'Restaurants i bars', kind: 'expense', color: '#e76f51' },
  { id: 'transport', name: 'Transport', kind: 'expense', color: '#457b9d' },
  { id: 'cotxe', name: 'Cotxe i carburant', kind: 'expense', color: '#1d3557' },
  { id: 'subscripcions', name: 'Subscripcions', kind: 'expense', color: '#8d5fd3' },
  { id: 'compres', name: 'Compres', kind: 'expense', color: '#f4a261' },
  { id: 'oci', name: 'Oci i esdeveniments', kind: 'expense', color: '#e9c46a' },
  { id: 'salut', name: 'Salut', kind: 'expense', color: '#06a77d' },
  { id: 'subministraments', name: 'Telèfon i subministraments', kind: 'expense', color: '#5c677d' },
  { id: 'assegurances', name: 'Assegurances', kind: 'expense', color: '#6d597a' },
  { id: 'impostos', name: 'Impostos', kind: 'expense', color: '#9d0208' },
  { id: 'viatges', name: 'Viatges', kind: 'expense', color: '#0096c7' },
  { id: 'divises', name: 'Canvi de divises', kind: 'expense', color: '#48cae4' },
  { id: 'efectiu', name: 'Retirada d\'efectiu', kind: 'expense', color: '#adb5bd' },
  { id: 'comissions', name: 'Comissions bancàries', kind: 'expense', color: '#6c757d' },
  { id: 'despeses-compartides', name: 'Despeses compartides', kind: 'expense', color: '#b5838d' },
  { id: 'altres-despeses', name: 'Altres despeses', kind: 'expense', color: '#999999' },
  { id: 'nomina', name: 'Nòmina', kind: 'income', color: '#2b9348' },
  { id: 'interessos', name: 'Interessos i rendiments', kind: 'income', color: '#55a630' },
  { id: 'altres-ingressos', name: 'Altres ingressos', kind: 'income', color: '#80b918' },
];
