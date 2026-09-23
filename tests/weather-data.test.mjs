import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, bounds, climatology, compare, csv, datesBetween, normalizeDaily, summarize, todayIn, validDate } from '../docs/js/weather-data.mjs';

test('acumulados, médias diárias e extremos não confundem ausência com zero', () => {
  const rows = normalizeDaily({ time: ['2024-02-01', '2024-02-02', '2024-02-03'], precipitation_sum: [0, 12, null],
    temperature_2m_mean: [10, 20, 30], temperature_2m_max: [40, 25, null], temperature_2m_min: [-2, 5, 8] });
  const [month] = aggregate(rows, '2024-02-01', '2024-02-04', 'month');
  assert.equal(month.precip, 12);
  assert.equal(month.mean, 20);
  assert.equal(month.max, 40);
  assert.equal(month.min, -2);
  assert.equal(month.expectedDays, 4);
  assert.deepEqual(month.counts, { precip: 2, mean: 3, max: 2, min: 3 });
  assert.equal(month.partial, true);
  assert.equal(month.clipped, true);
  const absent = aggregate(rows, '2024-02-03', '2024-02-04', 'day');
  assert.equal(absent[0].precip, null);
  assert.equal(absent[1].mean, null);
});

test('média anual pesa os dias em vez de dar o mesmo peso a cada mês', () => {
  const rows = datesBetween('2024-01-01', '2024-02-29').map(date => ({ date, precip: 1,
    mean: date.slice(5, 7) === '01' ? 10 : 20, max: 25, min: 5 }));
  const [year] = aggregate(rows, '2024-01-01', '2024-02-29', 'year');
  assert.equal(year.mean, (31 * 10 + 29 * 20) / 60);
  assert.equal(year.precip, 60);
  assert.equal(year.partial, false);
  assert.equal(year.clipped, true);
});

test('semanas começam na segunda e atravessam a virada do ano', () => {
  assert.deepEqual(bounds('2025-01-01', 'week'), ['2024-12-30', '2025-01-05']);
  const rows = aggregate([], '2024-12-29', '2025-01-06', 'week');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.expectedDays), [1, 7, 1]);
  assert.equal(rows[1].clipped, false);
});

test('datas civis, anos bissextos e fusos não mudam o dia consultado', () => {
  assert.equal(validDate('2023-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.deepEqual(bounds('2024-02-15', 'month'), ['2024-02-01', '2024-02-29']);
  assert.equal(todayIn('America/Sao_Paulo', new Date('2026-01-01T01:00:00Z')), '2025-12-31');
  assert.equal(todayIn('Asia/Tokyo', new Date('2026-01-01T01:00:00Z')), '2026-01-01');
  assert.throws(() => datesBetween('2026-02-01', '2026-01-01'));
});

test('comparação usa somente os mesmos dias com valores válidos de cada variável', () => {
  const baseline = [];
  for (let year = 1991; year <= 2020; year++) {
    baseline.push({ date: `${year}-01-01`, precip: 3, mean: 10 }, { date: `${year}-01-02`, precip: 7, mean: 20 });
  }
  const result = compare([{ date: '2026-01-01', precip: 5, mean: 12 }, { date: '2026-01-02', precip: null, mean: 22 }], climatology(baseline));
  assert.deepEqual(result.precip, { reference: 3, delta: 2, days: 1 });
  assert.deepEqual(result.mean, { reference: 15, delta: 2, days: 2 });
});

test('referência considera oito 29 de fevereiro e rejeita cobertura insuficiente', () => {
  const baseline = [];
  for (let year = 1992; year <= 2020; year += 4) baseline.push({ date: `${year}-02-29`, precip: 4, mean: 20 });
  assert.deepEqual(climatology(baseline).get('02-29'), { precip: 4, mean: 20 });
  baseline.pop();
  assert.deepEqual(climatology(baseline).get('02-29'), { precip: null, mean: null });
});

test('CSV contém todos os períodos, valores ausentes vazios e cobertura por variável', () => {
  const rows = aggregate([{ date: '2025-01-01', precip: 0, mean: -2.5, min: -8, max: 1 }], '2025-01-01', '2025-02-03', 'day');
  const output = csv(rows);
  assert.equal(output.charCodeAt(0), 0xfeff);
  assert.equal(output.split('\r\n').length, 35);
  assert.match(output, /2025-01-01;2025-01-01;0,00;-2,50;1,00;-8,00;1;1;1;1;1;nao/);
  assert.match(output, /2025-01-02;2025-01-02;;;;;0;0;0;0;1;sim/);
});

test('intervalo totalmente ausente mantém as quatro métricas indisponíveis', () => {
  const summary = summarize([], 30);
  assert.equal(summary.precip, null);
  assert.equal(summary.mean, null);
  assert.equal(summary.max, null);
  assert.equal(summary.min, null);
  assert.equal(summary.partial, true);
});
