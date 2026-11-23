// Matriz do histórico: cálculo puro (sem DOM) de linhas × colunas de calendário para uma variável.
import { aggregate, bounds, isoWeek } from './weather-data.mjs';

export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const WEEKDAYS_LONG = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

// noun/dayUnit descrevem o valor de um único dia, usado na contagem de dias.
export const METRICS = {
  precip: { label: 'Chuva', unit: 'mm', scale: 'rain', how: 'soma dos dias', noun: 'chuva', dayUnit: 'mm' },
  mean: { label: 'Temperatura média', unit: '°C', scale: 'temp', how: 'média das médias diárias', noun: 'temperatura média', dayUnit: '°C' },
  min: { label: 'Mínima', unit: '°C', scale: 'temp', how: 'mínima absoluta', noun: 'mínima', dayUnit: '°C' },
  max: { label: 'Máxima', unit: '°C', scale: 'temp', how: 'máxima absoluta', noun: 'máxima', dayUnit: '°C' },
  sun: { label: 'Horas de sol', unit: 'h/dia', scale: 'sun', how: 'média diária', noun: 'sol', dayUnit: 'h' },
};
// Contagem de dias: quantos dias do período têm o valor diário da variável de um lado do limite.
// As comparações incluem o próprio limite: "≥ 1 mm" é a definição usual de dia de chuva e
// "≤ 0 mm" conta os dias secos.
export const COUNT_OPS = {
  gte: { symbol: '≥', label: 'Igual ou acima', test: (value, limit) => value >= limit },
  lte: { symbol: '≤', label: 'Igual ou abaixo', test: (value, limit) => value <= limit },
};
export const COUNT_DEFAULTS = {
  precip: { op: 'gte', threshold: 1 }, mean: { op: 'gte', threshold: 25 }, min: { op: 'lte', threshold: 10 },
  max: { op: 'gte', threshold: 30 }, sun: { op: 'gte', threshold: 8 },
};
export const COUNT_LIMITS = {
  precip: { min: 0, max: 1000 }, mean: { min: -90, max: 60 }, min: { min: -90, max: 60 },
  max: { min: -90, max: 60 }, sun: { min: 0, max: 24 },
};
export function validCount(metric, count) {
  const limits = COUNT_LIMITS[metric];
  return Boolean(limits && count && COUNT_OPS[count.op] && Number.isFinite(count.threshold) &&
    count.threshold >= limits.min && count.threshold <= limits.max);
}
export function countScale(metric, op) {
  if (metric === 'precip') return op === 'gte' ? 'rain' : 'sun';
  if (metric === 'sun') return op === 'gte' ? 'sun' : 'rain';
  return op === 'gte' ? 'hot' : 'cold';
}
export const LAYOUTS = {
  'year-month': { label: 'Ano × Mês', rowName: 'Ano', group: 'month', drill: 'month-day', columns: 12 },
  'year-week': { label: 'Ano × Semana', rowName: 'Ano', group: 'week', drill: 'week-weekday', columns: 53 },
  'month-day': { label: 'Mês × Dia', rowName: 'Mês', group: 'day', drill: null, columns: 31 },
  'week-weekday': { label: 'Semana × Dia', rowName: 'Semana', group: 'day', drill: null, columns: 7 },
};
export const LAYOUT_FROM_GROUP = { day: 'month-day', week: 'week-weekday', month: 'year-month', year: 'year-month' };
// Períodos predefinidos: anos civis completos até hoje, incluindo o ano corrente.
export const PERIODS = [
  { key: '1', label: '1 ano' }, { key: '5', label: '5 anos' }, { key: '10', label: '10 anos' }, { key: '20', label: '20 anos' },
  { key: 'all', label: 'Todos' }, { key: 'custom', label: 'Personalizado' },
];
export const DEFAULT_PERIOD = '20';
export function periodRange(period, today) {
  if (period === 'all') return { start: '1940-01-01', end: today };
  const years = Number(period);
  if (!Number.isInteger(years) || years < 1) return null;
  return { start: `${Math.max(1940, Number(today.slice(0, 4)) - years + 1)}-01-01`, end: today };
}

export function dateLabel(date) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}
function monthLabel(key) { // key = 'AAAA-MM'
  return `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(0, 4)}`;
}
function monthTitle(key) {
  return `${MONTHS_LONG[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`;
}
function weekday(date) {
  return (new Date(date).getUTCDay() + 6) % 7;
}
export function columnsFor(layout) {
  if (layout === 'year-month') return MONTHS.map((label, i) => ({ key: String(i + 1).padStart(2, '0'), label, title: MONTHS_LONG[i] }));
  if (layout === 'year-week') return Array.from({ length: 53 }, (_, i) => ({ key: `W${i + 1}`, label: `S${i + 1}`, title: `Semana ${i + 1}` }));
  if (layout === 'month-day') return Array.from({ length: 31 }, (_, i) => ({ key: String(i + 1).padStart(2, '0'), label: String(i + 1), title: `Dia ${i + 1}` }));
  if (layout === 'week-weekday') return WEEKDAYS.map((label, i) => ({ key: label.toLowerCase(), label, title: WEEKDAYS_LONG[i] }));
  throw new Error(`Leitura desconhecida: ${layout}`);
}
// Onde cada período agregado cai na matriz.
function place(layout, bucket) {
  const date = bucket.periodStart;
  if (layout === 'year-month') {
    const year = date.slice(0, 4);
    return { rowKey: year, rowLabel: year, rowTitle: `Ano ${year}`, col: Number(date.slice(5, 7)) - 1 };
  }
  if (layout === 'year-week') {
    const { year, week } = isoWeek(date);
    return { rowKey: String(year), rowLabel: String(year), rowTitle: `Ano ${year}`, col: week - 1 };
  }
  if (layout === 'month-day') {
    const key = date.slice(0, 7);
    return { rowKey: key, rowLabel: monthLabel(key), rowTitle: monthTitle(key), col: Number(date.slice(8, 10)) - 1 };
  }
  const [monday, sunday] = bounds(date, 'week');
  return { rowKey: monday, rowLabel: dateLabel(monday), rowTitle: `Semana de ${dateLabel(monday)} a ${dateLabel(sunday)}`, col: weekday(date) };
}
function cellTitle(layout, bucket) {
  if (layout === 'year-month') return monthTitle(bucket.periodStart.slice(0, 7));
  if (layout === 'year-week') return `Semana de ${dateLabel(bucket.periodStart)} a ${dateLabel(bucket.periodEnd)}`;
  return `${WEEKDAYS_LONG[weekday(bucket.periodStart)]}, ${dateLabel(bucket.periodStart)}`;
}
// Sem "count", cada célula traz o valor agregado do período. Com count = { op, threshold }:
// nas leituras por mês ou semana a célula traz quantos dias atendem ao critério; nas leituras
// por dia traz o valor do dia e "match" diz se ele atende. Linhas e matriz ganham "total".
export function buildMatrix(rows, start, end, layout, metric, count = null) {
  const spec = LAYOUTS[layout];
  const info = METRICS[metric];
  if (!spec) throw new Error(`Leitura desconhecida: ${layout}`);
  if (!info) throw new Error(`Variável desconhecida: ${metric}`);
  if (count && !validCount(metric, count)) throw new Error('Critério de contagem inválido.');
  const test = count ? value => COUNT_OPS[count.op].test(value, count.threshold) : null;
  const daily = spec.group === 'day';
  const columns = columnsFor(layout);
  const byRow = new Map();
  const total = { matches: 0, count: 0, days: 0 };
  for (const bucket of aggregate(rows, start, end, spec.group)) {
    const { rowKey, rowLabel, rowTitle, col } = place(layout, bucket);
    if (!byRow.has(rowKey)) {
      byRow.set(rowKey, { key: rowKey, label: rowLabel, title: rowTitle, start: bucket.start, end: bucket.end,
        drill: null, cells: Array(columns.length).fill(null), total: count ? { matches: 0, count: 0, days: 0 } : null });
    }
    const row = byRow.get(rowKey);
    if (bucket.start < row.start) row.start = bucket.start;
    if (bucket.end > row.end) row.end = bucket.end;
    const valid = bucket.counts[metric];
    const cell = {
      value: bucket[metric], title: cellTitle(layout, bucket), start: bucket.start, end: bucket.end,
      periodStart: bucket.periodStart, periodEnd: bucket.periodEnd, days: bucket.expectedDays, count: valid,
      partial: valid < bucket.expectedDays, clipped: bucket.clipped,
      drill: spec.drill ? { layout: spec.drill, start: bucket.start, end: bucket.end } : null,
    };
    if (count) {
      cell.matches = bucket.rows.filter(day => Number.isFinite(day[metric]) && test(day[metric])).length;
      if (daily) cell.match = valid ? cell.matches === 1 : null;
      else cell.value = valid ? cell.matches : null; // Sem nenhum dia com dados não há o que contar.
      for (const sum of [row.total, total]) { sum.matches += cell.matches; sum.count += valid; sum.days += bucket.expectedDays; }
    }
    row.cells[col] = cell;
  }
  const matrixRows = [...byRow.values()].sort((a, b) => b.key.localeCompare(a.key)); // Mais recentes em cima.
  let min = null;
  let max = null;
  let minCell = null;
  let maxCell = null;
  let cells = 0;
  matrixRows.forEach((row, r) => {
    if (spec.drill) row.drill = { layout: spec.drill, start: row.start, end: row.end };
    row.cells.forEach((cell, c) => {
      if (!cell || !Number.isFinite(cell.value)) return;
      cells++;
      if (min === null || cell.value < min) { min = cell.value; minCell = { row: r, col: c }; }
      if (max === null || cell.value > max) { max = cell.value; maxCell = { row: r, col: c }; }
    });
  });
  const base = { layout, metric, label: info.label, unit: info.unit, scale: info.scale, rowName: spec.rowName,
    columns, rows: matrixRows, min, max, minCell, maxCell, count: cells, mode: 'value', daily };
  if (!count) return base;
  // Contagens partem de zero, e zero é comum demais para merecer destaque; nas leituras por dia
  // a cor diz apenas se o dia atende ao critério.
  const criterion = { metric, op: count.op, threshold: count.threshold, symbol: COUNT_OPS[count.op].symbol,
    noun: info.noun, unit: info.dayUnit };
  const maxTotal = matrixRows.reduce((top, row) => Math.max(top, row.total.matches), 0);
  return { ...base, mode: 'count', criterion, total, maxTotal, unit: daily ? info.dayUnit : 'dias',
    scale: countScale(metric, count.op), min: daily || !cells ? null : 0, max: daily ? null : max,
    minCell: null, maxCell: daily || !max ? null : maxCell };
}

// Escalas de cor: gradiente contínuo sobre os valores visíveis.
export const SCALES = {
  rain: [[255, 255, 255], [173, 205, 235], [28, 93, 153], [11, 42, 74]],
  sun: [[255, 255, 255], [253, 230, 138], [224, 123, 57], [154, 63, 12]],
  temp: [[33, 102, 172], [146, 197, 222], [247, 247, 247], [244, 165, 130], [178, 24, 43]],
  // Metades da escala de temperatura, para contagens de dias quentes e de dias frios.
  hot: [[255, 255, 255], [253, 219, 199], [244, 165, 130], [178, 24, 43]],
  cold: [[255, 255, 255], [209, 229, 240], [146, 197, 222], [33, 102, 172]],
};
export function interpolate(stops, t) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const position = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(position));
  const f = position - i;
  return stops[i].map((channel, k) => Math.round(channel + (stops[i + 1][k] - channel) * f));
}
export function luminance([r, g, b]) {
  const linear = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
export function cellStyle(value, min, max, scale) {
  const t = max === min ? 0.5 : (value - min) / (max - min);
  const rgb = interpolate(SCALES[scale], t);
  return { background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, color: luminance(rgb) < 0.35 ? '#ffffff' : '#1f2d3a', t };
}
export function gradientCSS(scale) {
  const stops = SCALES[scale];
  return `linear-gradient(90deg, ${stops.map((rgb, i) => `rgb(${rgb.join(', ')}) ${Math.round(100 * i / (stops.length - 1))}%`).join(', ')})`;
}
