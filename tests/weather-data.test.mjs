import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, bounds, datesBetween, isoWeek, normalizeDaily, summarize, todayIn, validDate } from '../docs/js/weather-data.mjs';

test('acumulados, médias diárias e extremos não confundem ausência com zero', () => {
  const rows = normalizeDaily({ time: ['2024-02-01', '2024-02-02', '2024-02-03'], precipitation_sum: [0, 12, null],
    temperature_2m_mean: [10, 20, 30], temperature_2m_max: [40, 25, null], temperature_2m_min: [-2, 5, 8],
    sunshine_duration: [3600, 7200, null] });
  const [month] = aggregate(rows, '2024-02-01', '2024-02-04', 'month');
  assert.equal(month.precip, 12);
  assert.equal(month.mean, 20);
  assert.equal(month.max, 40);
  assert.equal(month.min, -2);
  assert.equal(month.sun, 1.5);
  assert.equal(month.expectedDays, 4);
  assert.deepEqual(month.counts, { precip: 2, mean: 3, max: 2, min: 3, sun: 2 });
  assert.equal(month.partial, true);
  assert.equal(month.clipped, true);
  const absent = aggregate(rows, '2024-02-03', '2024-02-04', 'day');
  assert.equal(absent[0].precip, null);
  assert.equal(absent[1].mean, null);
});

test('horas de sol ausentes na resposta ficam como sem dados', () => {
  const rows = normalizeDaily({ time: ['2024-02-01'], precipitation_sum: [1], temperature_2m_mean: [10], temperature_2m_max: [12], temperature_2m_min: [8] });
  assert.equal(rows[0].sun, null);
  assert.equal(summarize(rows).sun, null);
  assert.equal(summarize(rows).partial, true);
});

test('média anual pesa os dias em vez de dar o mesmo peso a cada mês', () => {
  const rows = datesBetween('2024-01-01', '2024-02-29').map(date => ({ date, precip: 1,
    mean: date.slice(5, 7) === '01' ? 10 : 20, max: 25, min: 5, sun: 6 }));
  const [year] = aggregate(rows, '2024-01-01', '2024-02-29', 'year');
  assert.equal(year.mean, (31 * 10 + 29 * 20) / 60);
  assert.equal(year.precip, 60);
  assert.equal(year.sun, 6);
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

test('semana ISO pertence ao ano da quinta-feira', () => {
  assert.deepEqual(isoWeek('2025-01-01'), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek('2021-01-01'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2020-12-31'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2026-12-31'), { year: 2026, week: 53 });
});

test('datas civis, anos bissextos e fusos não mudam o dia consultado', () => {
  assert.equal(validDate('2023-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.deepEqual(bounds('2024-02-15', 'month'), ['2024-02-01', '2024-02-29']);
  assert.equal(todayIn('America/Sao_Paulo', new Date('2026-01-01T01:00:00Z')), '2025-12-31');
  assert.equal(todayIn('Asia/Tokyo', new Date('2026-01-01T01:00:00Z')), '2026-01-01');
  assert.throws(() => datesBetween('2026-02-01', '2026-01-01'));
});

test('intervalo totalmente ausente mantém as cinco métricas indisponíveis', () => {
  const summary = summarize([], 30);
  assert.equal(summary.precip, null);
  assert.equal(summary.mean, null);
  assert.equal(summary.max, null);
  assert.equal(summary.min, null);
  assert.equal(summary.sun, null);
  assert.equal(summary.partial, true);
});
