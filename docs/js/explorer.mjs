import { addDays, bounds, datesBetween, FIELDS, summarize, todayIn, validDate } from './weather-data.mjs';
import { forecast, history, resolveLocation, searchCities } from './weather-api.mjs';
import { clearCharts, dailyGroups, dateLabel, format, rangeLabel, renderCharts, summaryCards } from './weather-charts.mjs';
import { buildMatrix, cellStyle, COUNT_DEFAULTS, COUNT_LIMITS, COUNT_OPS, DEFAULT_PERIOD, gradientCSS, LAYOUTS, LAYOUT_FROM_GROUP, METRICS, PERIODS, periodRange, SCALES, interpolate, luminance, validCount } from './matrix.mjs';
import { LOCAIS, mesmoPonto, modeloPara, SAO_PAULO } from './locais.mjs';

const $ = id => document.getElementById(id);
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Safari privado/armazenamento cheio: a consulta continua. */ } }
function validLocation(value) {
  if (!value || typeof value.name !== 'string' || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return false;
  try { todayIn(value.timezone); return typeof value.timezone === 'string'; } catch { return false; }
}
const savedLocation = read('clima-location', SAO_PAULO);
let location = validLocation(savedLocation) ? savedLocation : SAO_PAULO;
let favorites = read('clima-favorites', [SAO_PAULO]);
favorites = Array.isArray(favorites) ? favorites.filter(validLocation).slice(0, 10) : [SAO_PAULO];
const savedFilters = read('clima-history-filters', {});
const savedCounts = savedFilters.counts && typeof savedFilters.counts === 'object' ? savedFilters.counts : {};
let filters = {
  period: PERIODS.some(item => item.key === savedFilters.period) ? savedFilters.period : DEFAULT_PERIOD,
  start: validDate(savedFilters.start) && savedFilters.start >= '1940-01-01' ? savedFilters.start : '1940-01-01',
  end: validDate(savedFilters.end) ? savedFilters.end : todayIn(location.timezone),
  // Filtros antigos guardavam "group"; a leitura equivalente é escolhida na migração.
  layout: LAYOUTS[savedFilters.layout] ? savedFilters.layout : LAYOUT_FROM_GROUP[savedFilters.group] ?? 'year-month',
  metric: METRICS[savedFilters.metric] ? savedFilters.metric : 'precip',
  // Contar dias: cada variável guarda o próprio critério, para a troca de variável não perder o limite.
  mode: savedFilters.mode === 'count' ? 'count' : 'value',
  counts: Object.fromEntries(Object.keys(METRICS).map(key => [key, validCount(key, savedCounts[key])
    ? { op: savedCounts[key].op, threshold: savedCounts[key].threshold } : { ...COUNT_DEFAULTS[key] }])),
};
if (filters.start > filters.end || filters.end > todayIn(location.timezone)) { filters.period = DEFAULT_PERIOD; filters.layout = 'year-month'; }
// Períodos predefinidos acompanham o "hoje" da localização; o personalizado só é recortado ao presente.
function clampToToday() {
  const today = todayIn(location.timezone);
  if (filters.period !== 'custom') { Object.assign(filters, periodRange(filters.period, today)); return; }
  if (filters.end > today) filters.end = today;
  if (filters.start > filters.end) filters.start = filters.end;
}
clampToToday();
let activeTab;
let historyLoaded = false;
let historyController;
let forecastController;
let historyRows = [];
const positions = new Map();
let searchController;
let geoRequest = 0;

function locationLabel(value) { return [...new Set([value.name, value.region, value.country].filter(Boolean))].join(', '); }
// Tendências e Sobre (app.js) mostram o ponto modelado da cidade: ela própria ou o mais próximo.
function announceModel() {
  const model = modeloPara(location);
  const detail = { slug: model.slug, nome: model.local.name, dados: model.dados, latitude: model.local.latitude,
    longitude: model.local.longitude, exato: model.exato, distanciaKm: model.distanciaKm, local: locationLabel(location) };
  window.climaModelo = detail; // Para o app.js, caso ele ainda não esteja ouvindo.
  document.dispatchEvent(new CustomEvent('clima:modelo', { detail }));
}
function updateLocationLabel() {
  $('location-name').textContent = locationLabel(location);
  $('location-timezone').textContent = location.timezone === 'auto' ? 'Identificando o fuso da localização…' : `Fuso: ${location.timezone.replaceAll('_', ' ')}`;
  $('history-start').max = $('history-end').max = todayIn(location.timezone);
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed',
    String(mesmoPonto(location, LOCAIS.find(item => item.slug === button.dataset.preset).local))));
  announceModel();
}
function navigate() {
  const requested = window.location.hash.slice(1);
  const tab = ['previsao', 'historico', 'tendencias', 'sobre'].includes(requested) ? requested : requested === 'skill' ? 'sobre' : 'previsao';
  if (activeTab) positions.set(activeTab, window.scrollY);
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== tab; });
  document.querySelectorAll('[data-tab]').forEach(link => {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const previous = activeTab;
  activeTab = tab;
  if (tab === 'historico' && !historyLoaded) loadHistory();
  requestAnimationFrame(() => {
    if (globalThis.Chart) Object.values(Chart.instances).forEach(chart => chart.resize());
    if (previous && previous !== tab) $(tab).querySelector('h2')?.focus({ preventScroll: true });
    window.scrollTo({ top: positions.get(tab) || 0, behavior: 'instant' });
    if (requested === 'skill') $('skill').scrollIntoView();
  });
}
window.addEventListener('hashchange', navigate);
window.history.scrollRestoration = 'manual';
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const fragment = link.getAttribute('href');
  if (fragment === '#conteudo') {
    event.preventDefault();
    $('conteudo').focus({ preventScroll: true });
    $('conteudo').scrollIntoView({ block: 'start' });
  } else if (['#previsao', '#historico', '#tendencias', '#sobre', '#skill'].includes(fragment)) {
    // Evita o salto automático da âncora antes de salvar a posição da aba anterior.
    event.preventDefault();
    if (window.location.hash !== fragment) window.history.pushState(null, '', fragment);
    navigate();
  }
});

function periodCard(row) {
  const card = document.createElement('article');
  card.className = 'period-card';
  const heading = document.createElement('h4');
  heading.textContent = rangeLabel(row);
  card.append(heading);
  if (row.partial || row.clipped) {
    const badge = document.createElement('span'); badge.className = 'partial-badge'; badge.textContent = 'Parcial'; card.append(badge);
  }
  const list = document.createElement('dl');
  for (const [key, label, unit] of [['precip', 'Chuva', 'mm'], ['mean', 'Média', '°C'], ['max', 'Máxima', '°C'], ['min', 'Mínima', '°C']]) {
    const pair = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const value = document.createElement('dd'); value.textContent = format(row[key], unit);
    if (row.counts[key] < row.expectedDays) value.textContent += ` (${row.counts[key]}/${row.expectedDays} dias)`;
    pair.append(term, value); list.append(pair);
  }
  card.append(list);
  return card;
}
async function loadForecast() {
  forecastController?.abort();
  const controller = new AbortController(); forecastController = controller;
  $('forecast-content').hidden = true;
  clearCharts('forecast');
  $('forecast-status').textContent = 'Carregando a previsão…';
  try {
    const result = await forecast(location, controller.signal);
    if (controller.signal.aborted) return;
    if (location.timezone === 'auto' && result.timezone) {
      location = { ...location, timezone: result.timezone }; save('clima-location', location); updateLocationLabel();
      clampToToday();
      historyLoaded = false;
      if (activeTab === 'historico') loadHistory();
    }
    const rows = dailyGroups(result.rows);
    if (!rows.length) throw new Error('A fonte não retornou dias de previsão.');
    $('forecast-content').hidden = false;
    $('forecast-summary-title').textContent = `Hoje · ${dateLabel(rows[0].start)}`;
    summaryCards($('forecast-summary'), rows[0]);
    renderCharts('forecast', rows, $('forecast-selection'));
    $('forecast-list').replaceChildren(...rows.map(row => periodCard(row)));
    $('forecast-status').textContent = `Previsão para ${locationLabel(location)} · Consultada às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (seu horário local) · Open-Meteo`;
  } catch (error) {
    if (!controller.signal.aborted) $('forecast-status').textContent = `${error.message} Use Atualizar para tentar novamente.`;
  }
}
$('forecast-retry').addEventListener('click', loadForecast);

function syncFilters() {
  $('history-start').value = filters.start; $('history-end').value = filters.end;
  $('custom-range').hidden = filters.period !== 'custom';
  document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === filters.period)));
  document.querySelectorAll('[data-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layout === filters.layout)));
  document.querySelectorAll('[data-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.metric === filters.metric)));
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === filters.mode)));
  const count = filters.counts[filters.metric];
  const info = METRICS[filters.metric];
  $('count-controls').hidden = filters.mode !== 'count';
  document.querySelectorAll('[data-op]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.op === count.op)));
  $('count-legend').textContent = `Contar os dias com ${info.noun}`;
  $('count-threshold').value = String(count.threshold);
  $('threshold-label').textContent = `Limite de ${info.noun}`;
  $('threshold-unit').textContent = info.dayUnit;
  $('count-hint').textContent = `Conta os dias em que ${DAY_PHRASE[filters.metric]} ${COUNT_OPS[count.op].label.toLowerCase()} de ${limitText(count.threshold)} ${info.dayUnit}. Dias sem dados ficam de fora.`;
  save('clima-history-filters', filters);
}
function takeDates() {
  if (!$('history-form').reportValidity()) return false;
  const start = $('history-start').value, end = $('history-end').value;
  if (!validDate(start) || !validDate(end) || start > end || start < '1940-01-01' || end > todayIn(location.timezone)) {
    $('history-status').textContent = 'Escolha um início anterior ao fim, entre 1940 e hoje.';
    return false;
  }
  filters = { ...filters, start, end };
  return true;
}
async function loadHistory() {
  historyController?.abort();
  const controller = new AbortController(); historyController = controller;
  historyLoaded = true;
  syncFilters();
  $('history-content').hidden = true;
  $('history-retry').hidden = true;
  $('history-status').textContent = 'Carregando o histórico…';
  historyRows = [];
  try {
    if (location.timezone === 'auto') {
      const resolved = await resolveLocation(location, controller.signal);
      if (controller.signal.aborted) return;
      location = resolved;
      save('clima-location', location);
      updateLocationLabel();
      clampToToday();
      syncFilters();
    }
    const rows = await history(location, filters.start, filters.end, controller.signal,
      text => { if (!controller.signal.aborted) $('history-status').textContent = text; });
    if (controller.signal.aborted) return;
    historyRows = rows;
    const validRows = rows.filter(row => FIELDS.some(key => Number.isFinite(row[key])));
    const last = validRows.at(-1)?.date;
    const summary = summarize(rows, datesBetween(filters.start, filters.end).length);
    $('history-status').textContent = last
      ? `ERA5 · ${locationLabel(location)} · Último dia com dados na consulta: ${dateLabel(last)}.${summary.partial ? ' Intervalo parcial: há dias ainda indisponíveis ou sem dados.' : ''}`
      : 'Sem dados disponíveis neste intervalo. O ERA5 costuma ter cerca de cinco dias de atraso. Escolha datas anteriores.';
    renderMatrix();
    $('history-content').hidden = false;
  } catch (error) {
    if (controller.signal.aborted) return;
    historyLoaded = false;
    $('history-status').textContent = error.message;
    $('history-retry').hidden = false;
  }
}
function drillTo({ layout, start, end }) {
  filters = { ...filters, period: 'custom', layout, start, end };
  loadHistory();
  $('history-title').focus({ preventScroll: true });
  $('history-form').scrollIntoView({ block: 'start' });
}
const compact = value => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = value => value.toLocaleString('pt-BR');
const limitText = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const dayWord = count => count === 1 ? 'dia' : 'dias';
const DAY_PHRASE = { precip: 'a chuva do dia ficou', mean: 'a temperatura média do dia ficou', min: 'a mínima do dia ficou',
  max: 'a máxima do dia ficou', sun: 'as horas de sol do dia ficaram' };
const criterionText = criterion => `${criterion.noun} ${criterion.symbol} ${limitText(criterion.threshold)} ${criterion.unit}`;
// Cor de quem atende ao critério nas leituras por dia: um tom firme da escala, não o extremo.
function hitStyle(scale) {
  const rgb = interpolate(SCALES[scale], 0.7);
  return { background: `rgb(${rgb.join(', ')})`, color: luminance(rgb) < 0.35 ? '#ffffff' : '#1f2d3a' };
}
function paint(element, style) { element.style.background = style.background; element.style.color = style.color; }
function drillButton(className, text, label, target) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = text;
  button.setAttribute('aria-label', `${label}. Abrir dias`);
  button.addEventListener('click', () => drillTo(target));
  return button;
}
function renderCountSummary(matrix, criterion) {
  const summary = $('count-summary');
  summary.hidden = matrix.mode !== 'count';
  summary.replaceChildren();
  if (summary.hidden) return;
  const { matches, count, days } = matrix.total;
  if (!count) { summary.textContent = `Sem dados no intervalo para contar os dias com ${criterion}.`; return; }
  const number = document.createElement('strong'); number.textContent = `${whole(matches)} ${dayWord(matches)}`;
  const share = (100 * matches / count).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  summary.append(number, ` com ${criterion}, de ${whole(count)} ${dayWord(count)} com dados (${share}%)`,
    count < days ? ` · ${whole(days - count)} sem dados no período` : '');
}
function renderMatrix() {
  const counting = filters.mode === 'count';
  const matrix = buildMatrix(historyRows, filters.start, filters.end, filters.layout, filters.metric,
    counting ? filters.counts[filters.metric] : null);
  const criterion = counting ? criterionText(matrix.criterion) : '';
  const span = `${LAYOUTS[filters.layout].label} · ${dateLabel(filters.start)} a ${dateLabel(filters.end)}`;
  $('matrix-caption').textContent = counting ? `Dias com ${criterion} · ${span}` : `${matrix.label} (${matrix.unit}) · ${span}`;
  renderCountSummary(matrix, criterion);
  const hit = counting && matrix.daily ? hitStyle(matrix.scale) : null;
  // Contagens partem de zero; sem nenhum dia no critério, tudo fica na ponta clara da escala.
  const heat = value => counting ? cellStyle(value, 0, matrix.max || 1, matrix.scale) : cellStyle(value, matrix.min, matrix.max, matrix.scale);
  const table = $('history-matrix'); table.replaceChildren();
  const head = table.createTHead().insertRow();
  const corner = document.createElement('th'); corner.scope = 'col'; corner.textContent = matrix.rowName; head.append(corner);
  if (counting) {
    const th = document.createElement('th'); th.scope = 'col'; th.className = 'total-col'; th.textContent = 'Total';
    th.title = `Dias da linha com ${criterion}`; th.setAttribute('aria-label', th.title); head.append(th);
  }
  for (const column of matrix.columns) {
    const th = document.createElement('th'); th.scope = 'col'; th.textContent = column.label; th.title = column.title;
    th.setAttribute('aria-label', column.title); head.append(th);
  }
  const body = table.createTBody();
  matrix.rows.forEach((row, r) => {
    const tr = body.insertRow();
    const th = document.createElement('th'); th.scope = 'row'; th.title = row.title;
    if (row.drill) th.append(drillButton('row-open', row.label, row.title, row.drill));
    else th.textContent = row.label;
    tr.append(th);
    if (counting) {
      const td = tr.insertCell(); const sum = row.total;
      td.className = sum.count ? 'total-cell' : 'total-cell empty';
      td.textContent = sum.count ? whole(sum.matches) : '–';
      td.title = sum.count ? `${row.title} · ${whole(sum.matches)} de ${whole(sum.count)} ${dayWord(sum.count)} com ${criterion}${sum.count < sum.days ? ` · ${whole(sum.days - sum.count)} sem dados` : ''}`
        : `${row.title} · Sem dados`;
      if (sum.count) paint(td, cellStyle(sum.matches, 0, matrix.maxTotal || 1, matrix.scale));
    }
    row.cells.forEach((cell, c) => {
      const td = tr.insertCell();
      if (!cell) { td.className = 'blank'; return; }
      const available = Number.isFinite(cell.value);
      const isMax = available && matrix.maxCell?.row === r && matrix.maxCell?.col === c;
      const isMin = available && matrix.minCell?.row === r && matrix.minCell?.col === c;
      let title;
      if (!counting) {
        title = `${cell.title} · ${format(cell.value, matrix.unit)}${cell.partial ? ` · ${cell.count}/${cell.days} dias` : ''}`;
        if (isMax) title += ' · máximo do período';
        if (isMin) title += ' · mínimo do período';
      } else if (!available) {
        title = `${cell.title} · Sem dados`;
      } else if (matrix.daily) {
        title = `${cell.title} · ${format(cell.value, matrix.unit)} · ${cell.match ? 'atende a' : 'não atende a'} ${criterion}`;
      } else {
        title = `${cell.title} · ${whole(cell.value)} de ${cell.count} ${dayWord(cell.count)} com ${criterion}${cell.partial ? ` · ${cell.count}/${cell.days} dias com dados` : ''}`;
        if (isMax) title += ' · maior contagem do período';
      }
      td.className = available ? 'heat' : 'empty';
      td.classList.toggle('is-max', isMax); td.classList.toggle('is-min', isMin);
      if (available && hit) { td.classList.add(cell.match ? 'hit' : 'miss'); if (cell.match) paint(td, hit); }
      else if (available) paint(td, heat(cell.value));
      td.title = title;
      const text = !available ? '–' : counting && !matrix.daily ? whole(cell.value) : compact(cell.value);
      if (cell.drill) td.append(drillButton('heat-cell', text, title, cell.drill));
      else td.textContent = text;
    });
  });
  const legend = $('matrix-legend'); legend.replaceChildren();
  if (!matrix.count) { legend.textContent = 'Sem valores no intervalo para esta variável.'; return; }
  const item = (text, className) => { const span = document.createElement('span'); span.className = className || ''; span.textContent = text; return span; };
  const bar = item('', 'legend-bar'); bar.style.background = gradientCSS(matrix.scale);
  const swatch = (text, className) => { const span = item(''); const mark = document.createElement('i'); mark.className = className; span.append(mark, text); return span; };
  if (hit) {
    const mark = swatch(`atende a ${criterion}`, 'legend-hit'); mark.firstChild.style.background = hit.background;
    legend.append(mark, swatch('não atende', 'legend-miss'), swatch('sem dados', 'legend-empty'));
  } else if (counting) {
    legend.append(item('0 dias'), bar, item(`Máx. ${whole(matrix.max)} ${dayWord(matrix.max)}`),
      swatch('sem dados', 'legend-empty'), swatch('maior contagem do período', 'legend-extreme'));
  } else {
    legend.append(item(`Mín. ${format(matrix.min, matrix.unit)}`), bar, item(`Máx. ${format(matrix.max, matrix.unit)}`),
      swatch('sem dados', 'legend-empty'), swatch('máximo e mínimo do período', 'legend-extreme'));
  }
}
// Aplica uma mudança de filtro: só consulta de novo se as datas mudaram ou não há matriz na tela.
function apply(change) {
  const before = filters.start + filters.end;
  if (filters.period === 'custom' && !takeDates()) return;
  change();
  if (filters.start + filters.end !== before || $('history-content').hidden) loadHistory();
  else { syncFilters(); renderMatrix(); }
}
const choose = (key, value) => apply(() => { filters[key] = value; });
function setThreshold(value) {
  const metric = filters.metric;
  const limits = COUNT_LIMITS[metric];
  if (!Number.isFinite(value)) { syncFilters(); return; } // Campo vazio ou inválido: volta ao limite em uso.
  const threshold = Math.min(limits.max, Math.max(limits.min, Math.round(value * 100) / 100));
  apply(() => { filters.counts[metric] = { ...filters.counts[metric], threshold }; });
}
$('history-form').addEventListener('submit', event => { event.preventDefault(); if (takeDates()) { filters.period = 'custom'; loadHistory(); } });
$('history-retry').addEventListener('click', loadHistory);
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  filters.period = button.dataset.period;
  if (filters.period === 'custom') { syncFilters(); $('history-start').focus({ preventScroll: true }); return; }
  clampToToday();
  loadHistory();
}));
document.querySelectorAll('[data-layout]').forEach(button => button.addEventListener('click', () => choose('layout', button.dataset.layout)));
document.querySelectorAll('[data-metric]').forEach(button => button.addEventListener('click', () => choose('metric', button.dataset.metric)));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => choose('mode', button.dataset.mode)));
document.querySelectorAll('[data-op]').forEach(button => button.addEventListener('click', () => apply(() => {
  filters.counts[filters.metric] = { ...filters.counts[filters.metric], op: button.dataset.op };
})));
$('count-threshold').addEventListener('change', event => setThreshold(event.target.valueAsNumber));
// Enter no campo do limite aplica o limite, em vez de enviar o formulário das datas.
$('count-threshold').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); setThreshold(event.target.valueAsNumber); }
});
$('threshold-minus').addEventListener('click', () => setThreshold(filters.counts[filters.metric].threshold - 1));
$('threshold-plus').addEventListener('click', () => setThreshold(filters.counts[filters.metric].threshold + 1));
function shiftRange(direction) {
  if (!takeDates()) return;
  const [monthStart, monthEnd] = bounds(filters.start, 'month');
  const [yearStart, yearEnd] = bounds(filters.start, 'year');
  let start, end;
  if (filters.start === yearStart && filters.end === yearEnd) {
    const year = Number(filters.start.slice(0, 4)) + direction; start = `${year}-01-01`; end = `${year}-12-31`;
  } else if (filters.start === monthStart && filters.end === monthEnd) {
    [start, end] = bounds(addDays(direction < 0 ? monthStart : monthEnd, direction), 'month');
  } else {
    const length = datesBetween(filters.start, filters.end).length;
    start = addDays(filters.start, direction * length); end = addDays(filters.end, direction * length);
  }
  const today = todayIn(location.timezone);
  if (start < '1940-01-01' || start > today) { $('history-status').textContent = 'O histórico permite consultas entre 1940 e hoje.'; return; }
  filters = { ...filters, period: 'custom', start, end: end > today ? today : end }; loadHistory();
}
$('range-prev').addEventListener('click', () => shiftRange(-1));
$('range-next').addEventListener('click', () => shiftRange(1));

function chooseLocation(value) {
  geoRequest++; searchController?.abort(); historyController?.abort();
  location = value; save('clima-location', location); updateLocationLabel();
  clampToToday();
  historyLoaded = false; historyRows = [];
  $('history-content').hidden = true;
  $('location-dialog').close();
  loadForecast();
  if (activeTab === 'historico') loadHistory();
}
for (const item of LOCAIS) {
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.preset = item.slug; button.textContent = item.local.name;
  button.addEventListener('click', () => { if (!mesmoPonto(location, item.local)) chooseLocation(item.local); });
  $('change-location').before(button);
}
function renderFavorites() {
  $('favorites').replaceChildren(...favorites.map((item, index) => {
    const row = document.createElement('div'); row.className = 'favorite-row';
    const button = document.createElement('button'); button.textContent = locationLabel(item); button.addEventListener('click', () => chooseLocation(item));
    const remove = document.createElement('button'); remove.textContent = 'Remover'; remove.setAttribute('aria-label', `Remover ${item.name} dos favoritos`);
    remove.addEventListener('click', () => { favorites.splice(index, 1); save('clima-favorites', favorites); renderFavorites(); });
    row.append(button, remove); return row;
  }));
}
$('change-location').addEventListener('click', () => { renderFavorites(); $('location-status').textContent = ''; $('location-dialog').showModal(); });
$('close-location').addEventListener('click', () => $('location-dialog').close());
$('location-dialog').addEventListener('close', () => { geoRequest++; searchController?.abort(); $('use-location').disabled = false; });
$('location-search').addEventListener('submit', async event => {
  event.preventDefault(); searchController?.abort();
  const controller = new AbortController(); searchController = controller;
  $('city-results').replaceChildren(); $('location-status').textContent = 'Buscando cidades…';
  try {
    const cities = await searchCities($('city-query').value.trim(), controller.signal);
    if (controller.signal.aborted) return;
    $('location-status').textContent = cities.length ? 'Selecione a cidade:' : 'Nenhuma cidade encontrada. Tente incluir o nome completo.';
    $('city-results').replaceChildren(...cities.map(city => {
      const button = document.createElement('button'); button.textContent = locationLabel(city); button.addEventListener('click', () => chooseLocation(city)); return button;
    }));
  } catch (error) { if (!controller.signal.aborted) $('location-status').textContent = error.message; }
});
$('save-location').addEventListener('click', () => {
  if (!favorites.some(item => item.latitude === location.latitude && item.longitude === location.longitude)) {
    if (favorites.length >= 10) { $('location-status').textContent = 'Você já tem dez favoritos. Remova um para adicionar outro.'; return; }
    favorites.push(location); save('clima-favorites', favorites); renderFavorites();
  }
  $('location-status').textContent = 'Local salvo nos favoritos.';
});
$('use-location').addEventListener('click', () => {
  if (!navigator.geolocation) { $('location-status').textContent = 'Localização indisponível. Busque uma cidade pelo nome.'; return; }
  const request = ++geoRequest;
  $('use-location').disabled = true; $('location-status').textContent = 'Aguardando sua localização…';
  navigator.geolocation.getCurrentPosition(position => {
    if (request !== geoRequest) return;
    $('use-location').disabled = false;
    chooseLocation({ name: 'Minha localização', region: '', country: '', latitude: Number(position.coords.latitude.toFixed(3)), longitude: Number(position.coords.longitude.toFixed(3)), timezone: 'auto' });
  }, () => {
    if (request !== geoRequest) return;
    $('use-location').disabled = false; $('location-status').textContent = 'Não foi possível acessar sua localização. Você pode buscar uma cidade pelo nome.';
  }, { timeout: 15000, maximumAge: 300000, enableHighAccuracy: false });
});

updateLocationLabel(); syncFilters(); navigate(); loadForecast();
