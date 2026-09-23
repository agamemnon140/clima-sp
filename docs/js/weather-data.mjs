// Datas civis da cidade: UTC serve apenas para aritmética, nunca para converter o dia local.
const DAY = 86400000;
export const FIELDS = ['precip', 'mean', 'max', 'min', 'sun'];
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
// Semana ISO: a semana (segunda a domingo) pertence ao ano da sua quinta-feira.
export function isoWeek(date) {
  const thursday = addDays(bounds(date, 'week')[0], 3);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor((Date.parse(thursday) - Date.parse(`${year}-01-01`)) / DAY / 7) + 1;
  return { year, week };
}
export function normalizeDaily(daily) {
  if (!Array.isArray(daily?.time)) throw new Error('A fonte retornou dados inválidos.');
  const mapping = { precip: 'precipitation_sum', mean: 'temperature_2m_mean', max: 'temperature_2m_max',
    min: 'temperature_2m_min', sun: 'sunshine_duration' };
  return daily.time.map((date, i) => ({ date, ...Object.fromEntries(
    Object.entries(mapping).map(([key, field]) => {
      const value = daily[field]?.[i];
      if (!Number.isFinite(value)) return [key, null];
      return [key, key === 'sun' ? value / 3600 : value]; // Duração de sol chega em segundos.
    }),
  ) }));
}
const AVERAGED = new Set(['mean', 'sun']);
export function summarize(rows, expectedDays = rows.length) {
  const counts = {};
  const result = {};
  for (const field of FIELDS) {
    const values = rows.map(row => row[field]).filter(Number.isFinite);
    counts[field] = values.length;
    result[field] = !values.length ? null : field === 'max' ? Math.max(...values) :
      field === 'min' ? Math.min(...values) : values.reduce((a, b) => a + b, 0) / (AVERAGED.has(field) ? values.length : 1);
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
