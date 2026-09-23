// Datas civis da cidade: UTC serve apenas para aritmética, nunca para converter o dia local.
const DAY = 86400000;
export const FIELDS = ['precip', 'mean', 'max', 'min'];
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}
export function addDays(value, days) {
  return new Date(Date.parse(value) + days * DAY).toISOString().slice(0, 10);
}
export function todayIn(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone === 'auto' ? undefined : timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = key => parts.find(p => p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function datesBetween(start, end) {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Intervalo de datas inválido.');
  const out = [];
  for (let date = start; date <= end; date = addDays(date, 1)) out.push(date);
  return out;
}
export function bounds(date, group) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (group === 'year') return [`${year}-01-01`, `${year}-12-31`];
  if (group === 'month') return [date.slice(0, 7) + '-01', new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)];
  if (group === 'week') {
    const start = addDays(date, -((new Date(date).getUTCDay() + 6) % 7));
    return [start, addDays(start, 6)];
  }
  return [date, date];
}
export function normalizeDaily(daily) {
  if (!Array.isArray(daily?.time)) throw new Error('A fonte retornou dados inválidos.');
  const mapping = { precip: 'precipitation_sum', mean: 'temperature_2m_mean', max: 'temperature_2m_max', min: 'temperature_2m_min' };
  return daily.time.map((date, i) => ({ date, ...Object.fromEntries(
    Object.entries(mapping).map(([key, field]) => [key, Number.isFinite(daily[field]?.[i]) ? daily[field][i] : null]),
  ) }));
}
export function summarize(rows, expectedDays = rows.length) {
  const counts = {};
  const result = {};
  for (const field of FIELDS) {
    const values = rows.map(row => row[field]).filter(Number.isFinite);
    counts[field] = values.length;
    result[field] = !values.length ? null : field === 'max' ? Math.max(...values) :
      field === 'min' ? Math.min(...values) : values.reduce((a, b) => a + b, 0) / (field === 'mean' ? values.length : 1);
  }
  return { ...result, counts, expectedDays, partial: FIELDS.some(key => counts[key] < expectedDays) };
}
export function aggregate(rows, start, end, group) {
  const source = new Map(rows.map(row => [row.date, row]));
  const buckets = new Map();
  for (const date of datesBetween(start, end)) {
    const [periodStart, periodEnd] = bounds(date, group);
    if (!buckets.has(periodStart)) buckets.set(periodStart, {
      periodStart, periodEnd, start: date, end: date, days: [], rows: [],
    });
    const bucket = buckets.get(periodStart);
    bucket.end = date;
    bucket.days.push(date);
    bucket.rows.push(source.get(date) || { date });
  }
  return [...buckets.values()].map(bucket => ({
    ...bucket, ...summarize(bucket.rows, bucket.days.length),
    clipped: bucket.start !== bucket.periodStart || bucket.end !== bucket.periodEnd,
  }));
}
// Normal diária do calendário, com 30 amostras (8 para 29/fev) por variável.
export function climatology(rows) {
  const days = new Map();
  for (const row of rows) {
    if (row.date < '1991-01-01' || row.date > '2020-12-31') continue;
    const key = row.date.slice(5);
    if (!days.has(key)) days.set(key, new Map());
    days.get(key).set(row.date, row);
  }
  return new Map([...days].map(([key, entries]) => {
    const values = [...entries.values()];
    const expected = key === '02-29' ? 8 : 30;
    const result = {};
    for (const field of ['precip', 'mean']) {
      const valid = values.map(r => r[field]).filter(Number.isFinite);
      result[field] = valid.length === expected ? valid.reduce((a, b) => a + b, 0) / expected : null;
    }
    return [key, result];
  }));
}
export function compare(rows, normal) {
  const result = {};
  for (const field of ['precip', 'mean']) {
    const observed = rows.filter(row => Number.isFinite(row[field]));
    const baseline = observed.map(row => normal.get(row.date.slice(5))?.[field]);
    const complete = baseline.length > 0 && baseline.every(Number.isFinite);
    const divisor = field === 'mean' ? observed.length : 1;
    const actual = observed.reduce((sum, row) => sum + row[field], 0) / divisor;
    const reference = complete ? baseline.reduce((a, b) => a + b, 0) / divisor : null;
    result[field] = { reference, delta: reference === null ? null : actual - reference, days: observed.length };
  }
  return result;
}
export function csv(rows) {
  const header = ['inicio', 'fim', 'precipitacao_mm', 'temperatura_media_C', 'maxima_C', 'minima_C',
    'dias_precipitacao', 'dias_media', 'dias_maxima', 'dias_minima', 'dias_selecionados', 'periodo_parcial'];
  const number = value => Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '';
  return '\uFEFF' + [header.join(';'), ...rows.map(row => [row.start, row.end,
    ...FIELDS.map(key => number(row[key])), ...FIELDS.map(key => row.counts[key]),
    row.expectedDays, row.partial || row.clipped ? 'sim' : 'nao'].join(';'))].join('\r\n');
}
