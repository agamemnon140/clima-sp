// Matriz do histórico: cálculo puro (sem DOM) de linhas × colunas de calendário para uma variável.
import { aggregate, bounds, isoWeek } from './weather-data.mjs';

export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
export const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const WEEKDAYS_LONG = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

export const METRICS = {
  precip: { label: 'Chuva', unit: 'mm', scale: 'rain', how: 'soma dos dias' },
  mean: { label: 'Temperatura média', unit: '°C', scale: 'temp', how: 'média das médias diárias' },
  min: { label: 'Mínima', unit: '°C', scale: 'temp', how: 'mínima absoluta' },
  max: { label: 'Máxima', unit: '°C', scale: 'temp', how: 'máxima absoluta' },
  sun: { label: 'Horas de sol', unit: 'h/dia', scale: 'sun', how: 'média diária' },
};
export const LAYOUTS = {
  'year-month': { label: 'Ano × Mês', rowName: 'Ano', group: 'month', drill: 'month-day', columns: 12 },
  'year-week': { label: 'Ano × Semana', rowName: 'Ano', group: 'week', drill: 'week-weekday', columns: 53 },
  'month-day': { label: 'Mês × Dia', rowName: 'Mês', group: 'day', drill: null, columns: 31 },
  'week-weekday': { label: 'Semana × Dia', rowName: 'Semana', group: 'day', drill: null, columns: 7 },
};
export const LAYOUT_FROM_GROUP = { day: 'month-day', week: 'week-weekday', month: 'year-month', year: 'year-month' };

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
export function buildMatrix(rows, start, end, layout, metric) {
  const spec = LAYOUTS[layout];
  const info = METRICS[metric];
  if (!spec) throw new Error(`Leitura desconhecida: ${layout}`);
  if (!info) throw new Error(`Variável desconhecida: ${metric}`);
  const columns = columnsFor(layout);
  const byRow = new Map();
  for (const bucket of aggregate(rows, start, end, spec.group)) {
    const { rowKey, rowLabel, rowTitle, col } = place(layout, bucket);
    if (!byRow.has(rowKey)) {
      byRow.set(rowKey, { key: rowKey, label: rowLabel, title: rowTitle, start: bucket.start, end: bucket.end,
        drill: null, cells: Array(columns.length).fill(null) });
    }
    const row = byRow.get(rowKey);
    if (bucket.start < row.start) row.start = bucket.start;
    if (bucket.end > row.end) row.end = bucket.end;
    const count = bucket.counts[metric];
    row.cells[col] = {
      value: bucket[metric], title: cellTitle(layout, bucket), start: bucket.start, end: bucket.end,
      periodStart: bucket.periodStart, periodEnd: bucket.periodEnd, days: bucket.expectedDays, count,
      partial: count < bucket.expectedDays, clipped: bucket.clipped,
      drill: spec.drill ? { layout: spec.drill, start: bucket.start, end: bucket.end } : null,
    };
  }
  const matrixRows = [...byRow.values()].sort((a, b) => a.key.localeCompare(b.key));
  let min = null;
  let max = null;
  let minCell = null;
  let maxCell = null;
  let count = 0;
  matrixRows.forEach((row, r) => {
    if (spec.drill) row.drill = { layout: spec.drill, start: row.start, end: row.end };
    row.cells.forEach((cell, c) => {
      if (!cell || !Number.isFinite(cell.value)) return;
      count++;
      if (min === null || cell.value < min) { min = cell.value; minCell = { row: r, col: c }; }
      if (max === null || cell.value > max) { max = cell.value; maxCell = { row: r, col: c }; }
    });
  });
  return { layout, metric, label: info.label, unit: info.unit, scale: info.scale, rowName: spec.rowName,
    columns, rows: matrixRows, min, max, minCell, maxCell, count };
}

// Escalas de cor: gradiente contínuo sobre os valores visíveis.
export const SCALES = {
  rain: [[255, 255, 255], [173, 205, 235], [28, 93, 153], [11, 42, 74]],
  sun: [[255, 255, 255], [253, 230, 138], [224, 123, 57], [154, 63, 12]],
  temp: [[33, 102, 172], [146, 197, 222], [247, 247, 247], [244, 165, 130], [178, 24, 43]],
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
