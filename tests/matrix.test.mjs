import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrix, cellStyle, columnsFor, gradientCSS, luminance, LAYOUT_FROM_GROUP } from '../docs/js/matrix.mjs';
import { datesBetween } from '../docs/js/weather-data.mjs';

const daily = (start, end, extra = {}) => datesBetween(start, end).map(date => ({ date, precip: 1, mean: 20, max: 30, min: 5, sun: 8, ...extra }));

test('ano × mês posiciona meses, deixa em branco o que está fora do intervalo e abre os dias', () => {
  const matrix = buildMatrix(daily('2025-01-01', '2026-03-31'), '2025-01-01', '2026-03-31', 'year-month', 'precip');
  assert.equal(matrix.columns.length, 12);
  assert.deepEqual(matrix.rows.map(row => row.key), ['2025', '2026']);
  assert.equal(matrix.rows[0].cells[1].value, 28);
  assert.deepEqual(matrix.rows[0].cells[1].drill, { layout: 'month-day', start: '2025-02-01', end: '2025-02-28' });
  assert.deepEqual(matrix.rows[0].drill, { layout: 'month-day', start: '2025-01-01', end: '2025-12-31' });
  assert.deepEqual(matrix.rows[1].cells.slice(3), Array(9).fill(null));
  assert.equal(matrix.rows[1].cells[2].title, 'março de 2026');
  assert.equal(matrix.unit, 'mm');
  assert.equal(matrix.count, 15);
});

test('ano × semana segue o ano ISO da quinta-feira', () => {
  const matrix = buildMatrix([], '2024-12-23', '2025-01-12', 'year-week', 'mean');
  assert.equal(matrix.columns.length, 53);
  assert.deepEqual(matrix.rows.map(row => row.key), ['2024', '2025']);
  const filled = row => row.cells.map((cell, i) => cell ? i : null).filter(i => i !== null);
  assert.deepEqual(filled(matrix.rows[0]), [51]);
  assert.deepEqual(filled(matrix.rows[1]), [0, 1]);
  const first = matrix.rows[1].cells[0];
  assert.equal(first.periodStart, '2024-12-30');
  assert.equal(first.value, null);
  assert.deepEqual(first.drill, { layout: 'week-weekday', start: '2024-12-30', end: '2025-01-05' });
  assert.deepEqual(matrix.rows[1].drill, { layout: 'week-weekday', start: '2024-12-30', end: '2025-01-12' });
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

test('semana × dia começa na segunda e rotula pela segunda-feira', () => {
  const matrix = buildMatrix([], '2025-01-01', '2025-01-07', 'week-weekday', 'min');
  assert.deepEqual(matrix.columns.map(column => column.label), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  assert.deepEqual(matrix.rows.map(row => row.key), ['2024-12-30', '2025-01-06']);
  assert.equal(matrix.rows[0].label, '30/12/2024');
  assert.deepEqual(matrix.rows[0].cells.slice(0, 2), [null, null]);
  assert.equal(matrix.rows[0].cells.slice(2).every(Boolean), true);
  assert.deepEqual(matrix.rows[1].cells.slice(2), Array(5).fill(null));
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

test('filtro antigo por agrupamento migra para uma leitura', () => {
  assert.equal(LAYOUT_FROM_GROUP.day, 'month-day');
  assert.equal(LAYOUT_FROM_GROUP.year, 'year-month');
  assert.equal(LAYOUT_FROM_GROUP.week, 'week-weekday');
  assert.equal(LAYOUT_FROM_GROUP.outro, undefined);
});
