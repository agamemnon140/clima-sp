import { addDays, bounds, datesBetween, FIELDS, summarize, todayIn, validDate } from './weather-data.mjs';
import { forecast, history, resolveLocation, SAO_PAULO, searchCities } from './weather-api.mjs';
import { clearCharts, dailyGroups, dateLabel, format, rangeLabel, renderCharts, summaryCards } from './weather-charts.mjs';
import { buildMatrix, cellStyle, gradientCSS, LAYOUTS, LAYOUT_FROM_GROUP, METRICS } from './matrix.mjs';

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
const defaultEnd = addDays(todayIn(location.timezone), -5);
const savedFilters = read('clima-history-filters', {});
let filters = {
  start: validDate(savedFilters.start) && savedFilters.start >= '1940-01-01' ? savedFilters.start : addDays(defaultEnd, -29),
  end: validDate(savedFilters.end) ? savedFilters.end : defaultEnd,
  // Filtros antigos guardavam "group"; a leitura equivalente é escolhida na migração.
  layout: LAYOUTS[savedFilters.layout] ? savedFilters.layout : LAYOUT_FROM_GROUP[savedFilters.group] ?? 'month-day',
  metric: METRICS[savedFilters.metric] ? savedFilters.metric : 'precip',
};
if (filters.start > filters.end || filters.end > todayIn(location.timezone)) filters = { start: addDays(defaultEnd, -29), end: defaultEnd, layout: 'month-day', metric: 'precip' };
let activeTab;
let historyLoaded = false;
let historyController;
let forecastController;
let historyRows = [];
const positions = new Map();
let searchController;
let geoRequest = 0;

function locationLabel(value) { return [...new Set([value.name, value.region, value.country].filter(Boolean))].join(', '); }
function updateLocationLabel() {
  $('location-name').textContent = locationLabel(location);
  $('location-timezone').textContent = location.timezone === 'auto' ? 'Identificando o fuso da localização…' : `Fuso: ${location.timezone.replaceAll('_', ' ')}`;
  $('history-start').max = $('history-end').max = todayIn(location.timezone);
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
  $('location-bar').hidden = !['previsao', 'historico'].includes(tab);
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
      const today = todayIn(location.timezone);
      if (filters.end > today) filters.end = today;
      if (filters.start > filters.end) filters.start = filters.end;
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
  document.querySelectorAll('[data-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layout === filters.layout)));
  document.querySelectorAll('[data-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.metric === filters.metric)));
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
      const today = todayIn(location.timezone);
      if (filters.end > today) filters.end = today;
      if (filters.start > filters.end) filters.start = filters.end;
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
  filters = { ...filters, layout, start, end };
  loadHistory();
  $('history-title').focus({ preventScroll: true });
  $('history-form').scrollIntoView({ block: 'start' });
}
const compact = value => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function drillButton(className, text, label, target) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.textContent = text;
  button.setAttribute('aria-label', `${label}. Abrir dias`);
  button.addEventListener('click', () => drillTo(target));
  return button;
}
function renderMatrix() {
  const matrix = buildMatrix(historyRows, filters.start, filters.end, filters.layout, filters.metric);
  $('matrix-caption').textContent = `${matrix.label} (${matrix.unit}) · ${LAYOUTS[filters.layout].label} · ${dateLabel(filters.start)} a ${dateLabel(filters.end)}`;
  const table = $('history-matrix'); table.replaceChildren();
  const head = table.createTHead().insertRow();
  const corner = document.createElement('th'); corner.scope = 'col'; corner.textContent = matrix.rowName; head.append(corner);
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
    row.cells.forEach((cell, c) => {
      const td = tr.insertCell();
      if (!cell) { td.className = 'blank'; return; }
      const available = Number.isFinite(cell.value);
      const isMax = available && matrix.maxCell?.row === r && matrix.maxCell?.col === c;
      const isMin = available && matrix.minCell?.row === r && matrix.minCell?.col === c;
      let title = `${cell.title} · ${format(cell.value, matrix.unit)}${cell.partial ? ` · ${cell.count}/${cell.days} dias` : ''}`;
      if (isMax) title += ' · máximo do período';
      if (isMin) title += ' · mínimo do período';
      td.className = available ? 'heat' : 'empty';
      td.classList.toggle('is-max', isMax); td.classList.toggle('is-min', isMin);
      if (available) {
        const style = cellStyle(cell.value, matrix.min, matrix.max, matrix.scale);
        td.style.background = style.background; td.style.color = style.color;
      }
      td.title = title;
      const text = available ? compact(cell.value) : '–';
      if (cell.drill) td.append(drillButton('heat-cell', text, title, cell.drill));
      else td.textContent = text;
    });
  });
  const legend = $('matrix-legend'); legend.replaceChildren();
  if (!matrix.count) { legend.textContent = 'Sem valores no intervalo para esta variável.'; return; }
  const item = (text, className) => { const span = document.createElement('span'); span.className = className || ''; span.textContent = text; return span; };
  const bar = item('', 'legend-bar'); bar.style.background = gradientCSS(matrix.scale);
  const swatch = (text, className) => { const span = item(''); const mark = document.createElement('i'); mark.className = className; span.append(mark, text); return span; };
  legend.append(item(`Mín. ${format(matrix.min, matrix.unit)}`), bar, item(`Máx. ${format(matrix.max, matrix.unit)}`),
    swatch('sem dados', 'legend-empty'), swatch('máximo e mínimo do período', 'legend-extreme'));
}
function choose(key, value) {
  const before = filters.start + filters.end;
  if (!takeDates()) return;
  filters[key] = value;
  if (filters.start + filters.end !== before || $('history-content').hidden) loadHistory();
  else { syncFilters(); renderMatrix(); }
}
$('history-form').addEventListener('submit', event => { event.preventDefault(); if (takeDates()) loadHistory(); });
$('history-retry').addEventListener('click', loadHistory);
document.querySelectorAll('[data-layout]').forEach(button => button.addEventListener('click', () => choose('layout', button.dataset.layout)));
document.querySelectorAll('[data-metric]').forEach(button => button.addEventListener('click', () => choose('metric', button.dataset.metric)));
document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
  const today = todayIn(location.timezone), year = Number(today.slice(0, 4));
  const kind = button.dataset.range;
  filters.end = kind === 'last-year' ? `${year - 1}-12-31` : kind === '30' ? addDays(today, -5) : today;
  filters.start = kind === 'last-year' ? `${year - 1}-01-01` : kind === 'year' ? `${year}-01-01` : kind === 'month' ? today.slice(0, 7) + '-01' : addDays(filters.end, -29);
  filters.layout = ['year', 'last-year'].includes(kind) ? 'year-month' : 'month-day';
  loadHistory();
}));
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
  filters = { ...filters, start, end: end > today ? today : end }; loadHistory();
}
$('range-prev').addEventListener('click', () => shiftRange(-1));
$('range-next').addEventListener('click', () => shiftRange(1));

function chooseLocation(value) {
  geoRequest++; searchController?.abort(); historyController?.abort();
  location = value; save('clima-location', location); updateLocationLabel();
  const today = todayIn(location.timezone);
  if (filters.end > today) filters.end = today;
  if (filters.start > filters.end) filters.start = filters.end;
  historyLoaded = false; historyRows = [];
  $('history-content').hidden = true;
  $('location-dialog').close();
  loadForecast();
  if (activeTab === 'historico') loadHistory();
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
