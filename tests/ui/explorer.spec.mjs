import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addDays, datesBetween } from '../../docs/js/weather-data.mjs';

const chartCode = await readFile('node_modules/chart.js/dist/chart.umd.js', 'utf8');
async function mockWeather(page, { archiveFail = false, seasonalFail = false, forecastFail = false, geoTimezone = 'America/Sao_Paulo' } = {}) {
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
    const old = Number(start.slice(0, 4)) < 2021;
    // Chuva = dia do mês: cada mês tem soma distinta e extremos previsíveis.
    return route.fulfill({ json: { timezone: Number(url.searchParams.get('latitude')) > 0 ? geoTimezone : 'America/Sao_Paulo', daily: { time,
      temperature_2m_mean: time.map(() => old ? 10 : 20), temperature_2m_max: time.map(() => 30),
      temperature_2m_min: time.map(() => 5), precipitation_sum: time.map(date => old ? 2 : Number(date.slice(8, 10))),
      sunshine_duration: time.map(() => old ? 18000 : 28800) } } });
  });
  if (seasonalFail) await page.route('**/data/mensal.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
}
async function queryDates(page, start, end) {
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

test('matriz ano × mês marca extremos, abre o ano e o mês em dias e preserva os filtros', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await queryDates(page, '2025-01-01', '2025-12-31');
  await page.getByRole('button', { name: 'Ano × Mês', exact: true }).click();
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
  expect(errors).toEqual([]);
});

test('ano × semana segue semanas ISO e abre a semana em dias de segunda a domingo', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await queryDates(page, '2024-12-23', '2025-01-12');
  await page.getByRole('button', { name: 'Ano × Semana', exact: true }).click();
  await expect(page.locator('#history-matrix thead th')).toHaveCount(54);
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(2);
  await expect(page.locator('#history-matrix tbody th')).toHaveText(['2024', '2025']);
  await page.getByRole('button', { name: /^Semana de 30\/12\/2024 a 05\/01\/2025/ }).click();
  await pressed(page, '[data-layout="week-weekday"]');
  await expect(page.locator('#history-start')).toHaveValue('2024-12-30');
  await expect(page.locator('#history-end')).toHaveValue('2025-01-05');
  await expect(page.locator('#history-matrix thead th')).toHaveText(['Semana', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  await expect(page.locator('#history-matrix tbody th')).toHaveText(['30/12/2024']);
  await expect(page.locator('#history-matrix td.heat')).toHaveText(['30,0', '31,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
});

test('troca de variável recolore sem nova consulta e mostra horas de sol', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  let requests = 0; page.on('request', request => { if (request.url().includes('archive-api')) requests++; });
  await page.getByRole('button', { name: 'Horas de sol', exact: true }).click();
  await expect(page.locator('#matrix-caption')).toContainText('Horas de sol (h/dia)');
  await expect(page.locator('#history-matrix td.heat').first()).toHaveText('8,0');
  await expect(page.locator('#matrix-legend')).toContainText('8,0 h/dia');
  await page.getByRole('button', { name: 'Mínima', exact: true }).click();
  await expect(page.locator('#matrix-caption')).toContainText('Mínima (°C)');
  await expect(page.locator('#history-matrix td.heat').first()).toHaveText('5,0');
  await page.getByRole('button', { name: 'Semana × Dia', exact: true }).click();
  await expect(page.locator('#history-matrix thead th')).toHaveCount(8);
  expect(requests).toBe(0);
});

test('cidade e favoritos persistem; tendências continuam em São Paulo', async ({ page }) => {
  await mockWeather(page); await page.goto('/');
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
  await expect(page.locator('#trends-title')).toHaveText('Tendências · São Paulo');
  await expect(page.locator('#location-bar')).toBeHidden();
  await page.reload(); await page.locator('[data-tab="previsao"]').click();
  await expect(page.locator('#location-name')).toContainText('Campinas');
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
  await page.getByRole('button', { name: 'Ano passado', exact: true }).click();
  await expect(page.locator('#history-matrix tbody button')).toHaveCount(13);
  const controls = await page.locator('#history-form button, #history-form input, .app-nav a, #history-matrix button').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
  expect(controls.every(height => height >= 44)).toBe(true);
  expect(await page.locator('#history-matrix thead th').first().evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  expect(await page.locator('#history-matrix tbody th').first().evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  await page.screenshot({ path: testInfo.outputPath('iphone-historico.png'), fullPage: true });
  await page.locator('#history-matrix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('iphone-matriz.png') });
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
  await page.getByRole('button', { name: 'Este mês', exact: true }).click();
  await expect(page.locator('#history-status')).toContainText('Intervalo parcial');
  await expect(page.locator('#history-matrix td.empty')).toHaveCount(5); // 19 a 23/09 ainda sem publicação
  await expect(page.locator('#history-matrix td.blank')).toHaveCount(8); // 24 a 30/09 fora do intervalo e o dia 31 inexistente
  await expect(page.locator('#history-matrix td.empty').first()).toHaveAttribute('title', /sábado, 19\/09\/2026 · Sem dados/);
  await queryDates(page, '2025-01-01', '2025-03-31');
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Semana × Dia', exact: true }).click();
  await expect(page.locator('#history-matrix tbody tr')).toHaveCount(14);
  await expect(page.locator('#history-matrix tbody th').first()).toHaveText('30/12/2024');
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
  await expect(page.locator('#history-end')).toHaveAttribute('max', '2026-09-24');
  await page.getByRole('button', { name: 'Este mês', exact: true }).click();
  await expect(page.locator('#history-matrix td.empty')).toHaveCount(5); // 20 a 24/09 no fuso de Tóquio
  await expect(page.locator('#history-matrix td.blank')).toHaveCount(7);
  await expect(page.locator('#history-status')).toContainText('19/09/2026');
  await page.locator('[data-tab="previsao"]').click();
  await expect(page.locator('#forecast-status')).toContainText('HTTP 503');
});
