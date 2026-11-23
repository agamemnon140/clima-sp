import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addDays, datesBetween } from '../../docs/js/weather-data.mjs';

const chartCode = await readFile('node_modules/chart.js/dist/chart.umd.js', 'utf8');
async function mockWeather(page, { archiveFail = false, seasonalFail = false, forecastFail = false, valinhosFail = false, geoTimezone = 'America/Sao_Paulo' } = {}) {
  await page.clock.setFixedTime(new Date('2026-09-23T15:00:00Z'));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: chartCode }));
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: 'Campinas', admin1: 'São Paulo', country: 'Brasil', latitude: -22.9, longitude: -47.06, timezone: 'America/Sao_Paulo' }] } }));
  await page.route(/https:\/\/(archive-api|api)\.open-meteo\.com\//, route => {
    const url = new URL(route.request().url());
    const archive = url.hostname === 'archive-api.open-meteo.com';
    if (archive && archiveFail) return route.fulfill({ status: 503, body: 'unavailable' });
    if (!archive && forecastFail) return route.fulfill({ status: 503, body: 'unavailable' });
    const start = archive ? url.searchParams.get('start_date') : '2026-09-23';
    const end = archive ? url.searchParams.get('end_date') : addDays(start, 15);
    const time = datesBetween(start, end);
    // Anos antes de 2021 sao "antigos" (valores menores); chuva = dia do mes nos demais, com extremos previsiveis.
    const old = date => Number(date.slice(0, 4)) < 2021;
    return route.fulfill({ json: { timezone: Number(url.searchParams.get('latitude')) > 0 ? geoTimezone : 'America/Sao_Paulo', daily: { time,
      temperature_2m_mean: time.map(date => old(date) ? 10 : 20), temperature_2m_max: time.map(() => 30),
      temperature_2m_min: time.map(() => 5), precipitation_sum: time.map(date => old(date) ? 2 : Number(date.slice(8, 10))),
      sunshine_duration: time.map(date => old(date) ? 18000 : 28800) } } });
  });
  if (seasonalFail) await page.route('**/data/mensal.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  // Modelo de Valinhos: os JSONs de São Paulo com marcas próprias, para os testes não dependerem
  // do que o pipeline já publicou e distinguirem um ponto do outro.
  await page.route('**/data/valinhos/*.json', async route => {
    if (valinhosFail) return route.fulfill({ status: 404, body: 'not found' });
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const data = JSON.parse(await readFile(`docs/data/${name}`, 'utf8'));
    if (name === 'meta.json') Object.assign(data, { local: 'Valinhos', coordenadas: { lat: -22.97, lon: -47 } });
    if (name === 'anual.json') data.taxa_aquecimento_decada = 0.99;
    return route.fulfill({ json: data });
  });
}
async function queryDates(page, start, end) {
  await page.getByRole('button', { name: 'Personalizado', exact: true }).click();
  await expect(page.locator('#custom-range')).toBeVisible();
  await page.locator('#history-start').fill(start); await page.locator('#history-end').fill(end);
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(page.locator('#history-content')).toBeVisible();
}
async function noOverflow(page) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1 || el.scrollWidth > el.clientWidth + 2) && !el.closest('.table-scroll'); }).map(el => `${el.tagName}#${el.id}.${el.className}: ${el.scrollWidth}/${el.clientWidth}`).slice(0, 20) }));
  expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width + 1);
}
const pressed = (page, selector) => expect(page.locator(selector)).toHaveAttribute('aria-pressed', 'true');

test('padrão mostra 20 anos em ano × mês, mais recentes em cima, e o seletor de período troca o intervalo', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await pressed(page, '[data-period="20"]'); await pressed(page, '[data-layout="year-month"]');
  await expect(page.locator('#custom-range')).toBeHidden();
  await expect(page.locator('#matrix-caption')).toContainText('01/01/2007 a 23/09/2026');
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(20);
  await expect(page.locator('#history-matrix tbody th').first()).toHaveText('2026');
  await expect(page.locator('#history-matrix tbody th').last()).toHaveText('2007');
  await page.getByRole('button', { name: '5 anos', exact: true }).click();
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(5);
  await expect(page.locator('#matrix-caption')).toContainText('01/01/2022 a 23/09/2026');
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(87);
  await expect(page.locator('#history-matrix tbody th').last()).toHaveText('1940');
  await page.getByRole('button', { name: 'Personalizado', exact: true }).click();
  await expect(page.locator('#custom-range')).toBeVisible();
  await expect(page.locator('#history-start')).toHaveValue('1940-01-01');
  await expect(page.locator('#history-end')).toHaveValue('2026-09-23');
  await page.reload(); await expect(page.locator('#history-content')).toBeVisible();
  await pressed(page, '[data-period="custom"]');
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(87);
  expect(errors).toEqual([]);
});

test('matriz ano × mês marca extremos, abre o ano e o mês em dias e preserva os filtros', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await queryDates(page, '2025-01-01', '2025-12-31');
  await expect(page.locator('#history-matrix thead th')).toHaveCount(13);
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(1);
  await expect(page.locator('#matrix-caption')).toContainText('Chuva (mm) · Ano × Mês · 01/01/2025 a 31/12/2025');
  await expect(page.locator('#history-matrix td.is-max')).toHaveText('496,0');
  await expect(page.locator('#history-matrix td.is-max')).toHaveAttribute('title', /janeiro de 2025 · 496,0 mm · máximo do período/);
  await expect(page.locator('#history-matrix td.is-min')).toHaveText('406,0');
  await expect(page.locator('#history-matrix td.is-min')).toHaveAttribute('title', /mínimo do período/);
  await expect(page.locator('#matrix-legend')).toContainText('Mín. 406,0 mm');
  await expect(page.locator('#matrix-legend')).toContainText('Máx. 496,0 mm');
  await page.getByRole('button', { name: 'Ano 2025. Abrir dias', exact: true }).click();
  await pressed(page, '[data-layout="month-day"]');
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(12);
  await expect(page.locator('#history-matrix tbody th').first()).toHaveText('dez/2025');
  await expect(page.locator('#history-matrix thead th')).toHaveCount(32);
  await expect(page.locator('#history-matrix tbody button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ano × Mês', exact: true }).click();
  await page.getByRole('button', { name: /^fevereiro de 2025 · 406,0 mm/ }).click();
  await pressed(page, '[data-layout="month-day"]');
  await expect(page.locator('#history-start')).toHaveValue('2025-02-01');
  await expect(page.locator('#history-end')).toHaveValue('2025-02-28');
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(1);
  await expect(page.locator('#history-matrix td.blank')).toHaveCount(3);
  await expect(page.locator('#history-matrix td.is-max')).toHaveText('28,0');
  await page.locator('[data-tab="previsao"]').click(); await page.locator('[data-tab="historico"]').click();
  await expect(page.locator('#history-start')).toHaveValue('2025-02-01');
  await page.reload(); await expect(page.locator('#history-content')).toBeVisible();
  await expect(page.locator('#history-start')).toHaveValue('2025-02-01');
  await pressed(page, '[data-layout="month-day"]');
  await pressed(page, '[data-period="custom"]');
  expect(errors).toEqual([]);
});

test('ano × semana segue semanas ISO e abre a semana em dias de segunda a domingo', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await queryDates(page, '2024-12-23', '2025-01-12');
  await page.getByRole('button', { name: 'Ano × Semana', exact: true }).click();
  await expect(page.locator('#history-matrix thead th')).toHaveCount(54);
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(2);
  await expect(page.locator('#history-matrix tbody th')).toHaveText(['2025', '2024']);
  await page.getByRole('button', { name: /^Semana de 30\/12\/2024 a 05\/01\/2025/ }).click();
  await pressed(page, '[data-layout="week-weekday"]');
  await expect(page.locator('#history-start')).toHaveValue('2024-12-30');
  await expect(page.locator('#history-end')).toHaveValue('2025-01-05');
  await expect(page.locator('#history-matrix thead th')).toHaveText(['Semana', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  await expect(page.locator('#history-matrix tbody th')).toHaveText(['30/12/2024']);
  await expect(page.locator('#history-matrix td.heat')).toHaveText(['30,0', '31,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
});

test('troca de variável ou leitura recolore sem nova consulta e mostra horas de sol', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  let requests = 0; page.on('request', request => { if (request.url().includes('archive-api')) requests++; });
  await page.getByRole('button', { name: 'Horas de sol', exact: true }).click();
  await expect(page.locator('#matrix-caption')).toContainText('Horas de sol (h/dia)');
  await expect(page.locator('#history-matrix td.heat').first()).toHaveText('8,0');
  await expect(page.locator('#history-matrix td.heat').last()).toHaveText('5,0');
  await expect(page.locator('#matrix-legend')).toContainText('Mín. 5,0 h/dia');
  await expect(page.locator('#matrix-legend')).toContainText('Máx. 8,0 h/dia');
  await page.getByRole('button', { name: 'Mínima', exact: true }).click();
  await expect(page.locator('#matrix-caption')).toContainText('Mínima (°C)');
  await expect(page.locator('#history-matrix td.heat').first()).toHaveText('5,0');
  await page.getByRole('button', { name: '1 ano', exact: true }).click();
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Semana × Dia', exact: true }).click();
  await expect(page.locator('#history-matrix thead th')).toHaveCount(8);
  await expect(page.locator('#history-matrix tbody th').first()).toHaveText('21/09/2026');
  expect(requests).toBe(0);
});

test('contar dias conta por mês, soma por ano e no período, e mudar o limite não consulta de novo', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await expect(page.locator('#count-controls')).toBeHidden(); await expect(page.locator('#count-summary')).toBeHidden();
  await queryDates(page, '2025-01-01', '2025-12-31');
  let requests = 0; page.on('request', request => { if (request.url().includes('archive-api')) requests++; });
  const summary = page.locator('#count-summary');
  const threshold = page.locator('#count-threshold');
  // No dado de teste a chuva de cada dia é o próprio dia do mês.
  await page.getByRole('button', { name: 'Contar dias', exact: true }).click();
  await expect(page.locator('#count-controls')).toBeVisible();
  await expect(page.locator('#count-legend')).toHaveText('Contar os dias com chuva');
  await expect(threshold).toHaveValue('1'); await pressed(page, '[data-op="gte"]');
  await expect(page.locator('#matrix-caption')).toHaveText('Dias com chuva ≥ 1 mm · Ano × Mês · 01/01/2025 a 31/12/2025');
  await expect(summary).toHaveText('365 dias com chuva ≥ 1 mm, de 365 dias com dados (100,0%)');
  await threshold.fill('20'); await threshold.press('Enter');
  await pressed(page, '[data-period="custom"]'); // Enter no limite não envia o formulário das datas.
  await expect(summary).toHaveText('137 dias com chuva ≥ 20 mm, de 365 dias com dados (37,5%)');
  await expect(page.locator('#history-matrix thead th')).toHaveText(['Ano', 'Total', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
  await expect(page.locator('#history-matrix td.total-cell')).toHaveText('137');
  await expect(page.locator('#history-matrix td.total-cell')).toHaveAttribute('title', 'Ano 2025 · 137 de 365 dias com chuva ≥ 20 mm');
  await expect(page.locator('#history-matrix td.heat')).toHaveText(['12', '9', '12', '11', '12', '11', '12', '12', '11', '12', '11', '12']);
  await expect(page.locator('#history-matrix td.is-max')).toHaveAttribute('title', 'janeiro de 2025 · 12 de 31 dias com chuva ≥ 20 mm · maior contagem do período');
  await expect(page.locator('#history-matrix td.is-min')).toHaveCount(0);
  await expect(page.locator('#matrix-legend')).toContainText('0 dias'); await expect(page.locator('#matrix-legend')).toContainText('Máx. 12 dias');
  await expect(page.locator('#count-hint')).toHaveText('Conta os dias em que a chuva do dia ficou igual ou acima de 20 mm. Dias sem dados ficam de fora.');
  await page.getByRole('button', { name: '≤ Igual ou abaixo', exact: true }).click();
  await expect(summary).toContainText('240 dias com chuva ≤ 20 mm'); // O dia 20 entra dos dois lados: o limite é inclusivo.
  await page.locator('#threshold-plus').click();
  await expect(threshold).toHaveValue('21'); await expect(summary).toContainText('252 dias com chuva ≤ 21 mm');
  await threshold.fill('20,5'.replace(',', '.')); await threshold.blur();
  await expect(summary).toContainText('240 dias com chuva ≤ 20,5 mm');
  await threshold.fill(''); await threshold.blur();
  await expect(threshold).toHaveValue('20.5'); // Campo vazio volta ao limite em uso.
  await page.locator('#threshold-minus').click(); await expect(threshold).toHaveValue('19.5');
  await page.locator('#threshold-plus').click(); await page.locator('#threshold-plus').click();
  await expect(summary).toContainText('252 dias com chuva ≤ 21,5 mm');
  expect(requests).toBe(0);
  // Abrir um mês mantém a contagem: os dias mostram o valor e a cor diz quem atende.
  await page.getByRole('button', { name: /^fevereiro de 2025 · 21 de 28 dias com chuva ≤ 21,5 mm/ }).click();
  await pressed(page, '[data-layout="month-day"]'); await pressed(page, '[data-mode="count"]');
  await expect(page.locator('#matrix-caption')).toHaveText('Dias com chuva ≤ 21,5 mm · Mês × Dia · 01/02/2025 a 28/02/2025');
  await expect(summary).toHaveText('21 dias com chuva ≤ 21,5 mm, de 28 dias com dados (75,0%)');
  await expect(page.locator('#history-matrix td.hit')).toHaveCount(21); await expect(page.locator('#history-matrix td.miss')).toHaveCount(7);
  await expect(page.locator('#history-matrix td.total-cell')).toHaveText('21');
  await expect(page.locator('#history-matrix td.hit').first()).toHaveAttribute('title', 'sábado, 01/02/2025 · 1,0 mm · atende a chuva ≤ 21,5 mm');
  await expect(page.locator('#history-matrix td.miss').last()).toHaveAttribute('title', 'sexta-feira, 28/02/2025 · 28,0 mm · não atende a chuva ≤ 21,5 mm');
  await expect(page.locator('#matrix-legend')).toContainText('atende a chuva ≤ 21,5 mm');
  // Cada variável guarda o próprio critério; a máxima do teste é sempre 30 e "≥ 30" a inclui.
  await page.getByRole('button', { name: 'Máxima', exact: true }).click();
  await expect(threshold).toHaveValue('30'); await pressed(page, '[data-op="gte"]');
  await expect(page.locator('#threshold-unit')).toHaveText('°C');
  await expect(summary).toHaveText('28 dias com máxima ≥ 30 °C, de 28 dias com dados (100,0%)');
  await page.locator('#threshold-plus').click();
  await expect(summary).toContainText('0 dias com máxima ≥ 31 °C');
  await page.reload(); await expect(page.locator('#history-content')).toBeVisible();
  await pressed(page, '[data-mode="count"]'); await expect(threshold).toHaveValue('31');
  await expect(summary).toContainText('0 dias com máxima ≥ 31 °C');
  await page.getByRole('button', { name: 'Chuva', exact: true }).click();
  await expect(threshold).toHaveValue('21.5'); await pressed(page, '[data-op="lte"]');
  await page.getByRole('button', { name: 'Valores', exact: true }).click();
  await expect(page.locator('#count-controls')).toBeHidden(); await expect(summary).toBeHidden();
  await expect(page.locator('#matrix-caption')).toContainText('Chuva (mm) · Mês × Dia');
  await expect(page.locator('#history-matrix td.total-cell')).toHaveCount(0);
  await expect(page.locator('#history-matrix td.is-max')).toHaveText('28,0');
  expect(errors).toEqual([]);
});

test('contar dias deixa de fora os dias sem dados e soma cada ano em períodos longos', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico'); await expect(page.locator('#history-content')).toBeVisible();
  await page.getByRole('button', { name: 'Contar dias', exact: true }).click();
  await page.getByRole('button', { name: 'Média', exact: true }).click(); // Padrão: média ≥ 25 °C; o teste tem 20 (desde 2021) ou 10.
  await expect(page.locator('#count-summary')).toContainText('0 dias com temperatura média ≥ 25 °C, de 7.201 dias com dados (0,0%) · 5 sem dados no período');
  await expect(page.locator('#history-matrix td.is-max')).toHaveCount(0);
  await page.locator('#count-threshold').fill('15'); await page.locator('#count-threshold').blur();
  await expect(page.locator('#count-summary')).toContainText('2.087 dias com temperatura média ≥ 15 °C'); // 01/01/2021 a 18/09/2026
  await expect(page.locator('#history-matrix td.total-cell')).toHaveCount(20);
  await expect(page.locator('#history-matrix td.total-cell').first()).toHaveText('261'); // 2026 até 18/09
  await expect(page.locator('#history-matrix td.total-cell').first()).toHaveAttribute('title', 'Ano 2026 · 261 de 261 dias com temperatura média ≥ 15 °C · 5 sem dados');
  await expect(page.locator('#history-matrix td.total-cell').nth(1)).toHaveText('365');
  await expect(page.locator('#history-matrix td.total-cell').last()).toHaveText('0');
  await expect(page.locator('#history-matrix tbody tr').first().locator('td.heat').last()).toHaveAttribute('title', 'setembro de 2026 · 18 de 18 dias com temperatura média ≥ 15 °C · 18/23 dias com dados');
  await page.getByRole('button', { name: 'Ano × Semana', exact: true }).click();
  await expect(page.locator('#history-matrix thead th')).toHaveCount(55);
  await expect(page.locator('#count-summary')).toContainText('2.087 dias');
  await queryDates(page, '2026-09-19', '2026-09-23');
  await expect(page.locator('#count-summary')).toHaveText('Sem dados no intervalo para contar os dias com temperatura média ≥ 15 °C.');
  await expect(page.locator('#history-matrix td.total-cell')).toHaveText('–');
});

test('cidade e favoritos persistem; tendências mostram o ponto modelado mais próximo', async ({ page }) => {
  await mockWeather(page); await page.goto('/');
  await expect(page.locator('#trends-title')).toHaveText('Tendências · São Paulo');
  await page.locator('#change-location').click(); await page.locator('#city-query').fill('Campinas');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.locator('#city-results button').click();
  await expect(page.locator('#location-name')).toContainText('Campinas');
  await expect(page.locator('#forecast-status')).toContainText('Campinas');
  await page.locator('#change-location').click(); await page.locator('#save-location').click();
  await expect(page.locator('#favorites')).toContainText('Campinas'); await page.locator('#close-location').click();
  await page.locator('[data-tab="historico"]').click();
  await expect(page.locator('#history-status')).toContainText('Campinas');
  await page.locator('[data-tab="tendencias"]').click();
  await expect(page.locator('#trends-title')).toHaveText('Tendências · Valinhos');
  await expect(page.locator('#trends-scope')).toHaveText(/^Não há modelo sazonal para Campinas, São Paulo, Brasil\. Mostrando o ponto modelado mais próximo: Valinhos \(-22,97; -47,00\), a cerca de 10 km\.$/);
  await expect(page.locator('#location-bar')).toBeVisible();
  await expect(page.locator('[data-preset][aria-pressed="true"]')).toHaveCount(0);
  await page.reload(); await page.locator('[data-tab="previsao"]').click();
  await expect(page.locator('#location-name')).toContainText('Campinas');
  await page.locator('[data-tab="sobre"]').click();
  await expect(page.locator('#about-scope')).toContainText('Valinhos, o ponto modelado mais próximo de Campinas');
});

test('atalho de Valinhos leva previsão, histórico e tendências para Valinhos, e São Paulo volta', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const points = new Set(); page.on('request', request => {
    const url = new URL(request.url()); if (url.hostname.endsWith('open-meteo.com')) points.add(`${url.hostname.split('.')[0]}:${url.searchParams.get('latitude')}`);
  });
  await mockWeather(page); await page.goto('/');
  await pressed(page, '[data-preset="sao-paulo"]');
  await expect(page.locator('#location-presets button')).toHaveText(['São Paulo', 'Valinhos', 'Outro local']);
  await page.getByRole('button', { name: 'Valinhos', exact: true }).click();
  await pressed(page, '[data-preset="valinhos"]');
  await expect(page.locator('[data-preset="sao-paulo"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#location-name')).toHaveText('Valinhos, São Paulo, Brasil');
  await expect(page.locator('#forecast-status')).toContainText('Previsão para Valinhos');
  await page.locator('[data-tab="historico"]').click();
  await expect(page.locator('#history-status')).toContainText('ERA5 · Valinhos');
  expect([...points].sort()).toEqual(['api:-22.97', 'api:-23.5', 'archive-api:-22.97']);
  await page.locator('[data-tab="tendencias"]').click();
  await expect(page.locator('#location-bar')).toBeVisible();
  await expect(page.locator('#trends-title')).toHaveText('Tendências · Valinhos');
  await expect(page.locator('#trends-scope')).toHaveText('Modelo sazonal ajustado ao ponto de Valinhos (-22,97; -47,00).');
  await expect(page.locator('#aquecimento-texto')).toContainText('no ponto de Valinhos sobe 0,99 °C por década');
  await expect(page.locator('#atualizacao')).toContainText('Última atualização sazonal de Valinhos');
  await expect(page.locator('#cards-previsao .card')).toHaveCount(4);
  await expect(page.locator('#cards-indices .card-indice')).toHaveCount(4);
  await expect(page.locator('#tendencias .legenda')).toHaveCount(1);
  await expect(page.locator('#meta-rodape')).toContainText('(-22.97, -47)');
  await page.locator('#seletor-anos [data-anos="10"]').click();
  await page.locator('[data-tab="sobre"]').click();
  await expect(page.locator('#about-scope')).toHaveText('Os painéis do modelo abaixo se referem a Valinhos.');
  await expect(page.locator('#tabela-skill tr')).toHaveCount(9);
  await page.reload();
  await pressed(page, '[data-preset="valinhos"]');
  await expect(page.locator('#about-scope')).toContainText('Valinhos');
  await page.locator('[data-tab="tendencias"]').click();
  await expect(page.locator('#trends-title')).toHaveText('Tendências · Valinhos');
  await page.getByRole('button', { name: 'São Paulo', exact: true }).click();
  await expect(page.locator('#trends-title')).toHaveText('Tendências · São Paulo');
  await expect(page.locator('#trends-scope')).toHaveText('Modelo sazonal ajustado ao ponto de São Paulo (-23,50; -46,62).');
  await expect(page.locator('#aquecimento-texto')).toContainText('no ponto de São Paulo sobe');
  await expect(page.locator('#aquecimento-texto')).not.toContainText('0,99');
  await expect(page.locator('#meta-rodape')).toContainText('(-23.5, -46.62)');
  await expect(page.locator('#cards-previsao .card')).toHaveCount(4);
  await expect(page.locator('#cards-indices .card-indice')).toHaveCount(4);
  await expect(page.locator('#tendencias .legenda')).toHaveCount(1);
  await expect(page.locator('.panel-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('sem os dados sazonais de Valinhos os painéis avisam, sem sobras de São Paulo, e a volta recupera', async ({ page }) => {
  await mockWeather(page, { valinhosFail: true }); await page.goto('/#tendencias');
  await expect(page.locator('#cards-previsao .card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Valinhos', exact: true }).click();
  await expect(page.locator('#trends-title')).toHaveText('Tendências · Valinhos');
  await expect(page.locator('.panel-error')).toHaveCount(7);
  await expect(page.locator('#cards-previsao .card')).toHaveCount(0);
  await expect(page.locator('#aquecimento-texto')).toBeEmpty();
  await expect(page.locator('#cards-indices .card-indice')).toHaveCount(4); // Índices são comuns aos pontos.
  await expect(page.locator('#forecast-status')).toContainText('Previsão para Valinhos');
  await page.getByRole('button', { name: 'São Paulo', exact: true }).click();
  await expect(page.locator('#cards-previsao .card')).toHaveCount(4);
  await expect(page.locator('.panel-error')).toHaveCount(0);
});

test('falha de painel sazonal não derruba a previsão nem o histórico', async ({ page }) => {
  await mockWeather(page, { seasonalFail: true }); await page.goto('/');
  await expect(page.locator('#forecast-content')).toBeVisible();
  await page.locator('[data-tab="historico"]').click(); await expect(page.locator('#history-content')).toBeVisible();
  await page.locator('[data-tab="tendencias"]').click(); await expect(page.locator('.panel-error')).toBeVisible();
  await expect(page.locator('#cards-previsao')).toContainText('+3 meses');
});

test('falha de histórico oferece nova tentativa sem valores antigos de outra cidade', async ({ page }) => {
  await mockWeather(page, { archiveFail: true }); await page.goto('/#historico');
  await expect(page.locator('#history-retry')).toBeVisible();
  await expect(page.locator('#history-content')).toBeHidden();
  await page.locator('[data-tab="previsao"]').click(); await expect(page.locator('#forecast-content')).toBeVisible();
});

test('iPhone estreito e texto ampliado preservam leitura e não transbordam', async ({ page }, testInfo) => {
  await mockWeather(page); await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await noOverflow(page);
  await expect(page.locator('#history-matrix tbody button')).toHaveCount(20 * 13 - 3); // 2026 so tem nove meses
  const controls = await page.locator('#history-form button:visible, #history-form input:visible, .app-nav a, #history-matrix button').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
  expect(controls.every(height => height >= 44)).toBe(true);
  expect(await page.locator('#history-matrix thead th').first().evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  expect(await page.locator('#history-matrix tbody th').first().evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  await page.screenshot({ path: testInfo.outputPath('iphone-historico.png'), fullPage: true });
  await page.locator('#history-matrix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('iphone-matriz.png') });
  await page.getByRole('button', { name: 'Personalizado', exact: true }).click();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Contar dias', exact: true }).click();
  await expect(page.locator('#count-summary')).toBeVisible();
  await noOverflow(page);
  const countControls = await page.locator('#count-controls button, #count-controls input, #location-presets button').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
  expect(countControls.length).toBe(8);
  expect(countControls.every(height => height >= 44)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('iphone-contagem.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  for (const tab of ['historico', 'previsao', 'tendencias', 'sobre']) {
    await page.locator(`[data-tab="${tab}"]`).click(); await noOverflow(page);
  }
  await page.locator('[data-tab="historico"]').click(); await page.locator('#change-location').click();
  await noOverflow(page);
});

test('histórico atual distingue dias sem dados de dias inexistentes', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico'); await expect(page.locator('#history-content')).toBeVisible();
  await queryDates(page, '2026-09-01', '2026-09-23');
  await page.getByRole('button', { name: 'Mês × Dia', exact: true }).click();
  await expect(page.locator('#history-status')).toContainText('Intervalo parcial');
  await expect(page.locator('#history-matrix td.empty')).toHaveCount(5); // 19 a 23/09 ainda sem publicação
  await expect(page.locator('#history-matrix td.blank')).toHaveCount(8); // 24 a 30/09 fora do intervalo e o dia 31 inexistente
  await expect(page.locator('#history-matrix td.empty').first()).toHaveAttribute('title', /sábado, 19\/09\/2026 · Sem dados/);
  await queryDates(page, '2025-01-01', '2025-03-31');
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(3);
  await expect(page.locator('#history-matrix tbody th').first()).toHaveText('mar/2025');
  await page.getByRole('button', { name: 'Semana × Dia', exact: true }).click();
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(14);
  await expect(page.locator('#history-matrix tbody th').first()).toHaveText('31/03/2025');
  await expect(page.locator('#history-matrix tbody th').last()).toHaveText('30/12/2024');
  await page.locator('#range-prev').click();
  await expect(page.locator('#history-start')).toHaveValue('2024-10-03');
  await expect(page.locator('#history-end')).toHaveValue('2024-12-31');
});

test('navegação preserva a rolagem e o atalho de teclado mantém a aba atual', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico'); await expect(page.locator('#history-content')).toBeVisible();
  await page.locator('#matrix-legend').scrollIntoViewIfNeeded();
  const previous = await page.evaluate(() => scrollY);
  // Aciona links sem a rolagem auxiliar que o runner usa para clicar na navegação desktop.
  await page.locator('[data-tab="previsao"]').evaluate(link => link.click());
  await expect(page.locator('#previsao')).toBeVisible();
  await page.locator('[data-tab="historico"]').evaluate(link => link.click());
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(previous, 0);
  await page.locator('.skip-link').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#historico')).toBeVisible();
  await expect(page.locator('#conteudo')).toBeFocused();
  await expect(page).toHaveURL(/#historico$/);
});

test('histórico resolve o fuso da geolocalização mesmo com previsão indisponível', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 35.676, longitude: 139.65 });
  await mockWeather(page, { forecastFail: true, geoTimezone: 'Asia/Tokyo' });
  await page.goto('/#historico'); await expect(page.locator('#history-content')).toBeVisible();
  await page.locator('#change-location').click(); await page.locator('#use-location').click();
  await expect(page.locator('#location-timezone')).toHaveText('Fuso: Asia/Tokyo');
  await expect(page.locator('#history-content')).toBeVisible();
  await expect(page.locator('#matrix-caption')).toContainText('a 24/09/2026'); // "hoje" no fuso de Tóquio
  await expect(page.locator('#history-end')).toHaveAttribute('max', '2026-09-24');
  await page.getByRole('button', { name: 'Mês × Dia', exact: true }).click();
  await queryDates(page, '2026-09-01', '2026-09-24');
  await expect(page.locator('#history-matrix td.empty')).toHaveCount(5); // 20 a 24/09 no fuso de Tóquio
  await expect(page.locator('#history-matrix td.blank')).toHaveCount(7);
  await expect(page.locator('#history-status')).toContainText('19/09/2026');
  await page.locator('[data-tab="previsao"]').click();
  await expect(page.locator('#forecast-status')).toContainText('HTTP 503');
});
