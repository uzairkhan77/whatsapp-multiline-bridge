/** Every value a period in the URL may take. The page falls back to a fortnight for anything else. */
export enum Period {
  Today = 'today',
  Yesterday = 'yesterday',
  Days7 = '7',
  Days14 = '14',
  Days30 = '30',
  Days90 = '90',
  All = 'all',
  Custom = 'custom',
}
