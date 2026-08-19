const CONFIG = {
  version: '1.6',
  date: '19.08.2026',

  pageSize: 50,
  previewLimit: 200,
  idbSizeLimit: 1 * 1024 * 1024 * 1024, // 1 GB — files below this are loaded into IDB
  maxFilterResults: 250000,
  workerBatchSize: 500,
  chunkSize: 4 * 1024 * 1024, // 4 MB

  operators: [
    { value: 'contains',     label: 'zawiera',        noValue: false, mono: false },
    { value: 'not_contains', label: 'nie zawiera',    noValue: false, mono: false },
    { value: 'equals',       label: 'równa się',      noValue: false, mono: false },
    { value: 'not_equals',   label: 'różna od',       noValue: false, mono: false },
    { value: 'starts_with',  label: 'zaczyna się od', noValue: false, mono: false },
    { value: 'ends_with',    label: 'kończy się na',  noValue: false, mono: false },
    { value: 'is_empty',     label: 'jest pusta',     noValue: true,  mono: false },
    { value: 'is_not_empty', label: 'nie jest pusta', noValue: true,  mono: false },
    { value: 'gt',           label: '>',              noValue: false, mono: false },
    { value: 'gte',          label: '>=',             noValue: false, mono: false },
    { value: 'lt',           label: '<',              noValue: false, mono: false },
    { value: 'lte',          label: '<=',             noValue: false, mono: false },
    { value: 'eq_num',       label: '= (liczba)',     noValue: false, mono: false },
    { value: 'neq_num',      label: '≠ (liczba)',     noValue: false, mono: false },
    { value: 'regex',        label: 'regex',          noValue: false, mono: true  },
  ],
};
