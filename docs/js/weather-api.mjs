import { addDays, normalizeDaily, todayIn } from './weather-data.mjs';

export const SAO_PAULO = { name: 'São Paulo', region: 'São Paulo', country: 'Brasil', latitude: -23.5, longitude: -46.62, timezone: 'America/Sao_Paulo' };
const VARIABLES = 'temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum';
const memory = new Map();
let database;
function openCache() {
  if (!database) database = new Promise(resolve => {
    try {
      const request = indexedDB.open('clima-history-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('years');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return database;
}
async function cache(key, value) {
  if (value) memory.set(key, value);
  else if (memory.has(key)) return memory.get(key);
  const db = await openCache();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const transaction = db.transaction('years', value ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('years');
      const request = value ? store.put(value, key) : store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = transaction.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
export async function getJSON(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) throw signal.reason;
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('A consulta demorou demais. Tente novamente.')), 45000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 429 ? 'A fonte está recebendo muitas consultas. Aguarde um pouco e tente novamente.' : `Não foi possível consultar a fonte (HTTP ${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
function params(location) {
  return new URLSearchParams({ latitude: location.latitude, longitude: location.longitude,
    timezone: location.timezone, daily: VARIABLES });
}
export async function forecast(location, signal) {
  const query = params(location);
  query.set('forecast_days', '16');
  const result = await getJSON(`https://api.open-meteo.com/v1/forecast?${query}`, signal);
  return { rows: normalizeDaily(result.daily), timezone: result.timezone };
}
export async function history(location, start, end, signal, progress = () => {}) {
  const latest = addDays(todayIn(location.timezone), -5);
  const cappedEnd = end < latest ? end : latest;
  if (start > cappedEnd) return [];
  const first = Number(start.slice(0, 4));
  const last = Number(cappedEnd.slice(0, 4));
  const prefix = `era5:${location.latitude}:${location.longitude}:${location.timezone}:`;
  const years = new Map();
  const missing = [];
  for (let year = first; year <= last; year++) {
    if (signal?.aborted) throw signal.reason;
    const saved = await cache(prefix + year);
    const ttl = year >= Number(latest.slice(0, 4)) - 1 ? 6 * 3600000 : 30 * 86400000;
    if (saved && Date.now() - saved.savedAt < ttl) years.set(year, saved.rows);
    else missing.push(year);
  }
  // Requisições sequenciais em blocos contíguos de até dez anos.
  for (let i = 0; i < missing.length;) {
    const from = missing[i];
    let to = from;
    i++;
    while (i < missing.length && missing[i] === to + 1 && missing[i] - from < 10) to = missing[i++];
    progress(`Consultando ${from}${to === from ? '' : `–${to}`}…`);
    const query = params(location);
    query.set('models', 'era5');
    query.set('start_date', `${from}-01-01`);
    query.set('end_date', `${to}-12-31` < latest ? `${to}-12-31` : latest);
    const result = normalizeDaily((await getJSON(`https://archive-api.open-meteo.com/v1/archive?${query}`, signal)).daily);
    for (let year = from; year <= to; year++) {
      const rows = result.filter(row => Number(row.date.slice(0, 4)) === year);
      years.set(year, rows);
      await cache(prefix + year, { rows, savedAt: Date.now() });
    }
  }
  return [...years.values()].flat().filter(row => row.date >= start && row.date <= cappedEnd).sort((a, b) => a.date.localeCompare(b.date));
}
export async function searchCities(name, signal) {
  const query = new URLSearchParams({ name, count: '6', language: 'pt', format: 'json' });
  const result = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${query}`, signal);
  return (result.results || []).map(item => ({ name: item.name, region: item.admin1 || '',
    country: item.country || '', latitude: item.latitude, longitude: item.longitude, timezone: item.timezone || 'auto' }));
}
