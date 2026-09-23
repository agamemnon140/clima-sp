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
    return route.fulfill({ json: { timezone: Number(url.searchParams.get('latitude')) > 0 ? geoTimezone : 'America/Sao_Paulo', daily: { time,
      temperature_2m_mean: time.map(() => old ? 10 : 20), temperature_2m_max: time.map(() => 30),
      temperature_2m_min: time.map(() => 5), precipitation_sum: time.map(() => old ? 2 : 3) } } });
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

test('histórico consulta, agrupa, detalha, compara e exporta todo o intervalo', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockWeather(page); await page.goto('/#historico');
  await expect(page.locator('#history-content')).toBeVisible();
  await queryDates(page, '2025-01-01', '2025-12-31');
  await page.getByRole('button', { name: 'Ano', exact: true }).click();
  await expect(page.locator('#history-summary')).toContainText('1.095,0 mm');
  await expect(page.locator('#history-summary')).toContainText('20,0 °C');
  await page.locator('#compare-normal').check();
  await expect(page.locator('#history-comparison')).toContainText('365,0 mm acima');
  await expect(page.locator('#history-comparison')).toContainText('10,0 °C acima');
  if (testInfo.project.name === 'desktop-chromium') await page.locator('.history-table-details summary').click();
  await page.getByRole('button', { name: '01/01/2025 a 31/12/2025', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('[data-group="month"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '01/02/2025 a 28/02/2025', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('[data-group="day"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#history-start')).toHaveValue('2025-02-01');
  const downloaded = page.waitForEvent('download'); await page.locator('#download-csv').click();
  const download = await downloaded;
  const data = await readFile(await download.path(), 'utf8');
  expect(data.split('\r\n')).toHaveLength(29);
  await page.locator('[data-tab="previsao"]').click(); await page.locator('[data-tab="historico"]').click();
  await expect(page.locator('#history-start')).toHaveValue('2025-02-01');
  await page.reload(); await expect(page.locator('#history-content')).toBeVisible();
  await expect(page.locator('#history-start')).toHaveValue('2025-02-01');
  expect(errors).toEqual([]);
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
  const controls = await page.locator('#history-form button, #history-form input, .app-nav a').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
  expect(controls.every(height => height >= 44)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('iphone-historico.png'), fullPage: true });
  await page.locator('#history-summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('iphone-graficos.png') });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  for (const tab of ['historico', 'previsao', 'tendencias', 'sobre']) {
    await page.locator(`[data-tab="${tab}"]`).click(); await noOverflow(page);
  }
  await page.locator('[data-tab="historico"]').click(); await page.locator('#change-location').click();
  await noOverflow(page);
});

test('histórico atual explicita dados parciais e pagina sem descartar valores do CSV', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico'); await expect(page.locator('#history-content')).toBeVisible();
  await page.getByRole('button', { name: 'Este mês', exact: true }).click();
  await expect(page.locator('#history-status')).toContainText('Intervalo parcial');
  await expect(page.locator('#history-summary')).toContainText('18/23 dias');
  await queryDates(page, '2025-01-01', '2025-03-31');
  await expect(page.locator('#page-status')).toContainText('Página 3 de 3');
  await page.locator('#page-prev').click(); await expect(page.locator('#page-status')).toContainText('Página 2 de 3');
  const downloaded = page.waitForEvent('download'); await page.locator('#download-csv').click();
  const file = await downloaded; expect((await readFile(await file.path(), 'utf8')).split('\r\n')).toHaveLength(91);
});

test('navegação preserva a rolagem e o atalho de teclado mantém a aba atual', async ({ page }) => {
  await mockWeather(page); await page.goto('/#historico'); await expect(page.locator('#history-content')).toBeVisible();
  await page.locator('#history-summary').scrollIntoViewIfNeeded();
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
  await expect(page.locator('#history-summary')).toContainText('19/24 dias');
  await expect(page.locator('#history-status')).toContainText('19/09/2026');
  await page.locator('[data-tab="previsao"]').click();
  await expect(page.locator('#forecast-status')).toContainText('HTTP 503');
});
