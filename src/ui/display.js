// Formats model values for the page (pure functions, no DOM, tested in test/display.test.js).

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatNumber(value) {
  return numberFormat.format(value);
}

// User-selectable date formats: day/month/year, month/day/year (AM/PM), year-month-day.
export const DATE_FORMATS = {
  dmy: 'DD/MM/YYYY',
  mdy: 'MM/DD/YYYY',
  ymd: 'YYYY-MM-DD',
};

let dateFormat = 'dmy';

export function setDateFormat(format) {
  if (DATE_FORMATS[format]) dateFormat = format;
}

export function getDateFormat() {
  return dateFormat;
}

// "2018-10-18T08:00" → "18/10/2018 08:00" | "10/18/2018 8:00 AM" | "2018-10-18 08:00"
// (file dates have no time zone; seconds aren't shown).
export function formatDate(value, empty = '', format = dateFormat) {
  if (!value) return empty;
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-');
  const hhmm = time.slice(0, 5);
  if (format === 'mdy') {
    const [hh, mm] = hhmm.split(':').map(Number);
    const hour = hh % 12 === 0 ? 12 : hh % 12;
    return `${m}/${d}/${y} ${hour}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  }
  if (format === 'ymd') return `${y}-${m}-${d} ${hhmm}`;
  return `${d}/${m}/${y} ${hhmm}`;
}

// Abbreviations as in English Project ("e" = elapsed).
const UNIT_LABELS = {
  MINUTES: 'min', HOURS: 'h', DAYS: 'd', WEEKS: 'wk', MONTHS: 'mo', YEARS: 'y',
  ELAPSED_MINUTES: 'emin', ELAPSED_HOURS: 'eh', ELAPSED_DAYS: 'ed', ELAPSED_WEEKS: 'ew',
  ELAPSED_MONTHS: 'emo', ELAPSED_YEARS: 'ey', PERCENT: '%', ELAPSED_PERCENT: 'e%',
};

export function formatDuration(d) {
  if (!d) return '';
  return `${numberFormat.format(d.value)} ${UNIT_LABELS[d.units] ?? d.units.toLowerCase()}`;
}

export function formatPercent(value) {
  return value === null || value === undefined ? '' : `${numberFormat.format(value)}%`;
}

// Relation abbreviations as in English Project.
export const RELATION_LABELS = { FINISH_START: 'FS', START_START: 'SS', FINISH_FINISH: 'FF', START_FINISH: 'SF' };

// One predecessor, Project style: "5", "5SS", "5FS+2 d", "5FF−1 h". id: visible ID of the linked task.
export function formatPredecessor(predecessor, id) {
  const hasLag = predecessor.lag && predecessor.lag.value !== 0;
  if (predecessor.type === 'FINISH_START' && !hasLag) return String(id);
  const lag = hasLag
    ? `${predecessor.lag.value > 0 ? '+' : '−'}${formatDuration({ ...predecessor.lag, value: Math.abs(predecessor.lag.value) })}`
    : '';
  return `${id}${RELATION_LABELS[predecessor.type] ?? ''}${lag}`;
}

export const RESOURCE_TYPE_LABELS = { WORK: 'Work', MATERIAL: 'Material', COST: 'Cost' };

const RATE_UNIT_LABELS = { MINUTES: 'min', HOURS: 'h', DAYS: 'd', WEEKS: 'wk', MONTHS: 'mo', YEARS: 'y' };

// Standard rate: work resources get the time unit; materials are per unit;
// cost resources have no rate.
export function formatRate(resource) {
  const rate = resource.standardRate;
  if (!rate || resource.type === 'COST') return '';
  if (resource.type === 'MATERIAL') return numberFormat.format(rate.amount);
  return `${numberFormat.format(rate.amount)}/${RATE_UNIT_LABELS[rate.units] ?? rate.units.toLowerCase()}`;
}

// Max units only mean something for work resources.
export function formatMaxUnits(resource) {
  return resource.type === 'WORK' ? formatPercent(resource.maxUnits) : '';
}

// Assignment units. Work (or unknown resource): percentage. Material: quantity (stored
// multiplied by 100). Cost: no units.
export function formatAssignmentUnits(assignment, resource) {
  if (assignment.units === null) return '';
  if (resource?.type === 'MATERIAL') return numberFormat.format(assignment.units / 100);
  if (resource?.type === 'COST') return '';
  return formatPercent(assignment.units);
}

// Assignment work: for materials it's a quantity (stored as "hours").
export function formatAssignmentWork(assignment, resource) {
  if (resource?.type === 'MATERIAL') return assignment.work ? numberFormat.format(assignment.work.value) : '';
  return formatDuration(assignment.work);
}

// Case- and accent-insensitive search.
export function normalizeText(text) {
  return (text ?? '').toLocaleLowerCase('en').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function matchesQuery(query, ...fields) {
  const q = normalizeText(query).trim();
  return q === '' || fields.some(f => normalizeText(f === null || f === undefined ? '' : String(f)).includes(q));
}

// --- custom fields ---

const CUSTOM_LABELS = { TEXT: 'Text', NUMBER: 'Number', COST: 'Cost', DATE: 'Date', START: 'Start', FINISH: 'Finish', DURATION: 'Duration', FLAG: 'Flag' };
const costFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Custom numbers: up to 6 decimals, so small values don't show up as "0".
const customNumberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

// Org-defined enterprise fields: data type -> field type used for formatting.
const ENTERPRISE_KINDS = { STRING: 'TEXT', NUMERIC: 'NUMBER', CURRENCY: 'COST', DATE: 'DATE', DURATION: 'DURATION', BOOLEAN: 'FLAG' };
const ORGANIZATION_FIELD = /^ENTERPRISE_CUSTOM_FIELD(\d+)$/;

// Default name as in English Project: "TEXT3" → "Text3", "ENTERPRISE_COST2" → "Enterprise Cost2";
// unnamed org-defined fields: "ENTERPRISE_CUSTOM_FIELD8" → "Enterprise field 8".
export function customFieldLabel(field) {
  const organization = ORGANIZATION_FIELD.exec(field);
  if (organization) return `Enterprise field ${organization[1]}`;
  const [, enterprise, prefix, number] = /^(ENTERPRISE_)?([A-Z]+)(\d+)$/.exec(field) ?? [];
  if (!CUSTOM_LABELS[prefix]) return field;
  return `${enterprise ? 'Enterprise ' : ''}${CUSTOM_LABELS[prefix]}${number}`;
}

// Value formatted by field type (from the name, or `type` for org-defined fields):
// costs with two decimals, flags as "Yes".
export function formatCustomValue(field, value, type) {
  const kind = ORGANIZATION_FIELD.test(field) ? ENTERPRISE_KINDS[type] : /^(?:ENTERPRISE_)?([A-Z]+)/.exec(field)?.[1];
  switch (kind) {
    case 'NUMBER': return customNumberFormat.format(value);
    case 'COST': return costFormat.format(value);
    case 'DATE':
    case 'START':
    case 'FINISH': return formatDate(value);
    case 'DURATION': return formatDuration(value);
    case 'FLAG': return value ? 'Yes' : 'No';
    default: return String(value);
  }
}

// Display name of a field: the one set in Project, with the default name in brackets
// (org-defined fields: just the name, if any).
export function customFieldName(field, names = {}) {
  const label = customFieldLabel(field);
  const name = names?.[field];
  return name ? (ORGANIZATION_FIELD.test(field) ? name : `${name} (${label})`) : label;
}

// [label, value] rows for the details. types: org-defined field types.
export function customFieldRows(customFields, names = {}, types = {}) {
  return (customFields ?? []).map(({ field, value }) => [customFieldName(field, names), formatCustomValue(field, value, types?.[field])]);
}

// --- custom columns ---

const KIND_ORDER = ['TEXT', 'NUMBER', 'COST', 'DATE', 'START', 'FINISH', 'DURATION', 'FLAG'];

// Column order: local fields, then fixed-name enterprise, then org-defined;
// within each group by type (as in Project) and number.
function columnRank(field) {
  const organization = ORGANIZATION_FIELD.exec(field);
  if (organization) return [2, 0, Number(organization[1])];
  const [, enterprise, prefix, number] = /^(ENTERPRISE_)?([A-Z]+)(\d+)$/.exec(field) ?? [];
  const kind = KIND_ORDER.indexOf(prefix);
  return [enterprise ? 1 : 0, kind === -1 ? KIND_ORDER.length : kind, Number(number)];
}

function compareRanks(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// All custom and enterprise fields of an item: field -> value.
export function customFieldValues(item) {
  return new Map([...(item.customFields ?? []), ...(item.enterpriseFields ?? [])].map(({ field, value }) => [field, value]));
}

// Columns on offer: fields with a value in at least one item, with their display name.
export function availableColumns(items, names = {}) {
  const fields = new Set();
  for (const item of items) for (const field of customFieldValues(item).keys()) fields.add(field);
  return [...fields]
    .sort((a, b) => compareRanks(columnRank(a), columnRank(b)))
    .map(field => ({ field, label: customFieldName(field, names) }));
}

// Text of an added cell: formatted value, empty if the field has none.
export function customColumnText(values, field, types = {}) {
  return values.has(field) ? formatCustomValue(field, values.get(field), types?.[field]) : '';
}

// Progress bar width in percent (0-100), null when missing.
export function progressWidth(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.min(100, Math.max(0, value));
}

// Values for the summary cards on the Project tab. % complete comes from the project
// summary task (unique ID 0), as Project shows it; null if the file doesn't have it.
export function projectSummary(model) {
  const tasks = model.tasks.filter(t => t.uid !== 0 && !t.null);
  return {
    start: model.project.start ?? null,
    finish: model.project.finish ?? null,
    percentComplete: model.tasks.find(t => t.uid === 0)?.percentComplete ?? null,
    tasks: tasks.length,
    milestones: tasks.filter(t => t.milestone).length,
    resources: model.resources.filter(r => r.uid !== 0).length,
    assignments: model.assignments.filter(a => a.resourceUid !== null).length,
  };
}
