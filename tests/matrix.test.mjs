import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrix, cellStyle, columnsFor, countScale, COUNT_DEFAULTS, gradientCSS, luminance, LAYOUT_FROM_GROUP, METRICS, periodRange, validCount } from '../docs/js/matrix.mjs';
import { datesBetween } from '../docs/js/weather-data.mjs';

const daily = (start, end, extra = {}) => datesBetween(start, end).map(date => ({ date, precip: 1, mean: 20, max: 30, min: 5, sun: 8, ...extra }));

test('ano × mês posiciona meses, mais recentes em cima, em branco fora do intervalo e abre os dias', () => {
  const matrix = buildMatrix(daily('2025-01-01', '2026-03-31'), '2025-01-01', '2026-03-31', 'year-month', 'precip');
  assert.equal(matrix.columns.length, 12);
  assert.deepEqual(matrix.rows.map(row => row.key), ['2026', '2025']);
  const [recent, older] = matrix.rows;
  assert.equal(older.cells[1].value, 28);
  assert.deepEqual(older.cells[1].drill, { layout: 'month-day', start: '2025-02-01', end: '2025-02-28' });
  assert.deepEqual(older.drill, { layout: 'month-day', start: '2025-01-01', end: '2025-12-31' });
  assert.deepEqual(recent.cells.slice(3), Array(9).fill(null));
  assert.equal(recent.cells[2].title, 'março de 2026');
  assert.deepEqual(recent.drill, { layout: 'month-day', start: '2026-01-01', end: '2026-03-31' });
  assert.equal(matrix.unit, 'mm');
  assert.equal(matrix.count, 15);
});

test('ano × semana segue o ano ISO da quinta-feira', () => {
  const matrix = buildMatrix([], '2024-12-23', '2025-01-12', 'year-week', 'mean');
  assert.equal(matrix.columns.length, 53);
  assert.deepEqual(matrix.rows.map(row => row.key), ['2025', '2024']);
  const filled = row => row.cells.map((cell, i) => cell ? i : null).filter(i => i !== null);
  assert.deepEqual(filled(matrix.rows[1]), [51]);
  assert.deepEqual(filled(matrix.rows[0]), [0, 1]);
  const first = matrix.rows[0].cells[0];
  assert.equal(first.periodStart, '2024-12-30');
  assert.equal(first.value, null);
  assert.deepEqual(first.drill, { layout: 'week-weekday', start: '2024-12-30', end: '2025-01-05' });
  assert.deepEqual(matrix.rows[0].drill, { layout: 'week-weekday', start: '2024-12-30', end: '2025-01-12' });
});

test('mês × dia não tem detalhamento, marca dias inexistentes e distingue ausência de zero', () => {
  const matrix = buildMatrix(daily('2025-02-01', '2025-02-27'), '2025-02-01', '2025-02-28', 'month-day', 'max');
  assert.equal(matrix.columns.length, 31);
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0].label, 'fev/2025');
  assert.equal(matrix.rows[0].title, 'fevereiro de 2025');
  assert.equal(matrix.rows[0].drill, null);
  assert.equal(matrix.rows[0].cells[0].drill, null);
  assert.deepEqual(matrix.rows[0].cells.slice(28), [null, null, null]);
  const missing = matrix.rows[0].cells[27];
  assert.equal(missing.value, null);
  assert.equal(missing.days, 1);
  assert.equal(missing.count, 0);
  assert.equal(missing.partial, true);
  assert.equal(matrix.rows[0].cells[0].title, 'sábado, 01/02/2025');
});

test('semana × dia começa na segunda, rotula pela segunda-feira e ordena da mais recente', () => {
  const matrix = buildMatrix([], '2025-01-01', '2025-01-07', 'week-weekday', 'min');
  assert.deepEqual(matrix.columns.map(column => column.label), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  assert.deepEqual(matrix.rows.map(row => row.key), ['2025-01-06', '2024-12-30']);
  assert.equal(matrix.rows[1].label, '30/12/2024');
  assert.deepEqual(matrix.rows[1].cells.slice(0, 2), [null, null]);
  assert.equal(matrix.rows[1].cells.slice(2).every(Boolean), true);
  assert.deepEqual(matrix.rows[0].cells.slice(2), Array(5).fill(null));
});

test('horas de sol são média diária e a unidade acompanha', () => {
  const rows = [{ date: '2025-03-01', sun: 2 }, { date: '2025-03-02', sun: 4 }, { date: '2025-03-03', sun: 6 }];
  const matrix = buildMatrix(rows, '2025-03-01', '2025-03-03', 'year-month', 'sun');
  assert.equal(matrix.rows[0].cells[2].value, 4);
  assert.equal(matrix.rows[0].cells[2].count, 3);
  assert.equal(matrix.unit, 'h/dia');
  assert.equal(matrix.scale, 'sun');
});

test('extremos apontam a primeira ocorrência e matriz vazia não tem escala', () => {
  const rows = daily('2025-01-01', '2025-01-05').map((row, i) => ({ ...row, precip: [3, 9, 1, 9, 1][i] }));
  const matrix = buildMatrix(rows, '2025-01-01', '2025-01-05', 'month-day', 'precip');
  assert.equal(matrix.min, 1);
  assert.equal(matrix.max, 9);
  assert.deepEqual(matrix.minCell, { row: 0, col: 2 });
  assert.deepEqual(matrix.maxCell, { row: 0, col: 1 });
  const empty = buildMatrix([], '2025-01-01', '2025-01-05', 'month-day', 'precip');
  assert.equal(empty.min, null);
  assert.equal(empty.minCell, null);
  assert.equal(empty.count, 0);
});

test('escala de cor mantém texto legível e trata intervalo sem variação', () => {
  const low = cellStyle(0, 0, 10, 'rain');
  assert.equal(low.background, 'rgb(255, 255, 255)');
  assert.equal(low.color, '#1f2d3a');
  const high = cellStyle(10, 0, 10, 'rain');
  assert.equal(high.background, 'rgb(11, 42, 74)');
  assert.equal(high.color, '#ffffff');
  assert.equal(cellStyle(5, 5, 5, 'temp').t, 0.5);
  assert.equal(cellStyle(5, 5, 5, 'temp').background, 'rgb(247, 247, 247)');
  assert.ok(Math.abs(luminance([255, 255, 255]) - 1) < 1e-9);
  assert.equal(luminance([0, 0, 0]), 0);
  assert.match(gradientCSS('sun'), /^linear-gradient\(90deg, rgb\(255, 255, 255\) 0%, .*rgb\(154, 63, 12\) 100%\)$/);
  assert.equal(columnsFor('year-week')[52].label, 'S53');
});

test('períodos predefinidos cobrem anos civis até hoje e nunca antes de 1940', () => {
  assert.deepEqual(periodRange('20', '2026-09-23'), { start: '2007-01-01', end: '2026-09-23' });
  assert.deepEqual(periodRange('1', '2026-09-23'), { start: '2026-01-01', end: '2026-09-23' });
  assert.deepEqual(periodRange('5', '2026-01-01'), { start: '2022-01-01', end: '2026-01-01' });
  assert.deepEqual(periodRange('all', '2026-09-23'), { start: '1940-01-01', end: '2026-09-23' });
  assert.deepEqual(periodRange('100', '2026-09-23'), { start: '1940-01-01', end: '2026-09-23' });
  assert.equal(periodRange('custom', '2026-09-23'), null);
});

test('filtro antigo por agrupamento migra para uma leitura', () => {
  assert.equal(LAYOUT_FROM_GROUP.day, 'month-day');
  assert.equal(LAYOUT_FROM_GROUP.year, 'year-month');
  assert.equal(LAYOUT_FROM_GROUP.week, 'week-weekday');
  assert.equal(LAYOUT_FROM_GROUP.outro, undefined);
});

test('contagem de dias por mês inclui o próprio limite, soma por linha e não conta dia sem dado', () => {
  // jan/2025: máximas 28, 29, 30, 31, 32 repetidas; fev/2025 só tem dados em parte dos dias.
  const rows = daily('2025-01-01', '2025-02-10').map((row, i) => ({ ...row, max: 28 + (i % 5) }));
  const matrix = buildMatrix(rows, '2025-01-01', '2025-02-28', 'year-month', 'max', { op: 'gte', threshold: 30 });
  assert.equal(matrix.mode, 'count');
  assert.equal(matrix.unit, 'dias');
  assert.equal(matrix.scale, 'hot');
  const [jan, feb] = matrix.rows[0].cells;
  assert.equal(jan.value, 18); // 31 dias: 6 ciclos completos (3 de cada 5) + o dia 31, que vale 28
  assert.equal(jan.matches, 18);
  assert.equal(jan.count, 31);
  assert.equal(jan.partial, false);
  assert.equal(feb.value, 6); // 10 dias com dados: 29, 30, 31, 32, 28, 29, 30, 31, 32, 28
  assert.equal(feb.count, 10);
  assert.equal(feb.days, 28);
  assert.equal(feb.partial, true);
  assert.deepEqual(feb.drill, { layout: 'month-day', start: '2025-02-01', end: '2025-02-28' });
  assert.deepEqual(matrix.rows[0].total, { matches: 24, count: 41, days: 59 });
  assert.deepEqual(matrix.total, { matches: 24, count: 41, days: 59 });
  assert.equal(matrix.maxTotal, 24);
  assert.equal(matrix.min, 0);
  assert.equal(matrix.max, 18);
  assert.deepEqual(matrix.maxCell, { row: 0, col: 0 });
  assert.equal(matrix.minCell, null);
  assert.deepEqual(matrix.criterion, { metric: 'max', op: 'gte', threshold: 30, symbol: '≥', noun: 'máxima', unit: '°C' });
  const below = buildMatrix(rows, '2025-01-01', '2025-01-31', 'year-month', 'max', { op: 'lte', threshold: 30 });
  assert.equal(below.rows[0].cells[0].value, 19); // 28, 29 e o próprio 30
  assert.equal(below.scale, 'cold');
});

test('contagem em período sem nenhum dado fica sem valor, não zero', () => {
  const matrix = buildMatrix([], '2025-01-01', '2025-01-31', 'year-month', 'precip', { op: 'gte', threshold: 1 });
  assert.equal(matrix.rows[0].cells[0].value, null);
  assert.equal(matrix.rows[0].cells[0].count, 0);
  assert.deepEqual(matrix.total, { matches: 0, count: 0, days: 31 });
  assert.equal(matrix.max, null);
  assert.equal(matrix.maxCell, null);
  assert.equal(matrix.count, 0);
});

test('contagem nas leituras por dia mantém o valor do dia e marca quem atende ao critério', () => {
  const rows = daily('2025-03-03', '2025-03-08').map((row, i) => ({ ...row, precip: [0, 0.9, 1, 12, null, 0][i] }));
  const matrix = buildMatrix(rows, '2025-03-03', '2025-03-09', 'week-weekday', 'precip', { op: 'gte', threshold: 1 });
  const cells = matrix.rows[0].cells;
  assert.deepEqual(cells.map(cell => cell.value), [0, 0.9, 1, 12, null, 0, null]);
  assert.deepEqual(cells.map(cell => cell.match), [false, false, true, true, null, false, null]);
  assert.deepEqual(matrix.rows[0].total, { matches: 2, count: 5, days: 7 });
  assert.equal(matrix.unit, 'mm');
  assert.equal(matrix.daily, true);
  assert.equal(matrix.max, null);
  assert.equal(matrix.maxCell, null);
  const dry = buildMatrix(rows, '2025-03-03', '2025-03-09', 'week-weekday', 'precip', { op: 'lte', threshold: 0 });
  assert.deepEqual(dry.total, { matches: 2, count: 5, days: 7 }); // dias secos: os dois zeros
  assert.equal(dry.scale, 'sun');
});

test('contagem por semana soma semanas ISO e o total da matriz bate com a soma das linhas', () => {
  const rows = daily('2024-12-23', '2025-01-12').map(row => ({ ...row, min: row.date < '2025-01-01' ? 8 : 15 }));
  const matrix = buildMatrix(rows, '2024-12-23', '2025-01-12', 'year-week', 'min', { op: 'lte', threshold: 10 });
  assert.deepEqual(matrix.rows.map(row => [row.key, row.total.matches]), [['2025', 2], ['2024', 7]]);
  assert.equal(matrix.rows[0].cells[0].value, 2); // semana de 30/12 a 05/01: dois dias ainda em 2024
  assert.equal(matrix.total.matches, 9);
  assert.equal(matrix.maxTotal, 7);
});

test('critérios de contagem têm padrão válido por variável e recusam limites fora da faixa', () => {
  for (const metric of Object.keys(METRICS)) assert.equal(validCount(metric, COUNT_DEFAULTS[metric]), true, metric);
  assert.equal(validCount('sun', { op: 'gte', threshold: 25 }), false);
  assert.equal(validCount('precip', { op: 'gte', threshold: -1 }), false);
  assert.equal(validCount('max', { op: 'entre', threshold: 30 }), false);
  assert.equal(validCount('max', { op: 'gte', threshold: Number.NaN }), false);
  assert.equal(validCount('max', null), false);
  assert.throws(() => buildMatrix([], '2025-01-01', '2025-01-02', 'month-day', 'max', { op: 'gte', threshold: 99 }), /Critério/);
  assert.equal(countScale('precip', 'gte'), 'rain');
  assert.equal(countScale('sun', 'lte'), 'rain');
  assert.equal(countScale('mean', 'gte'), 'hot');
  assert.match(gradientCSS('cold'), /rgb\(33, 102, 172\) 100%\)$/);
});
