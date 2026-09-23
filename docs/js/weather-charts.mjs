import { summarize } from './weather-data.mjs';

export const format = (value, unit = '') => Number.isFinite(value)
  ? `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}${unit ? ' ' + unit : ''}` : 'Sem dados';
export const dateLabel = date => date.split('-').reverse().join('/');
export const rangeLabel = row => row.start === row.end ? dateLabel(row.start) : `${dateLabel(row.start)} a ${dateLabel(row.end)}`;
const charts = new Map();
export function clearCharts(prefix) {
  for (const kind of ['temp', 'rain']) {
    charts.get(`${prefix}-${kind}`)?.destroy();
    charts.delete(`${prefix}-${kind}`);
  }
}
export function summaryCards(target, summary) {
  const specs = [['precip', 'Chuva acumulada', 'mm'], ['mean', 'Temperatura média', '°C'], ['max', 'Máxima absoluta', '°C'], ['min', 'Mínima absoluta', '°C']];
  target.replaceChildren(...specs.map(([key, label, unit]) => {
    const card = document.createElement('div');
    card.className = `metric metric-${key}`;
    const title = document.createElement('span');
    title.textContent = label;
    const value = document.createElement('strong');
    value.textContent = format(summary[key], unit);
    card.append(title, value);
    if (summary.counts[key] < summary.expectedDays) {
      const note = document.createElement('small');
      note.textContent = `${summary.counts[key]}/${summary.expectedDays} dias · parcial`;
      card.append(note);
    }
    return card;
  }));
}
export function showSelection(target, row) {
  target.textContent = `${rangeLabel(row)} · Chuva: ${format(row.precip, 'mm')} · Média: ${format(row.mean, '°C')} · Máxima: ${format(row.max, '°C')} · Mínima: ${format(row.min, '°C')}${row.partial || row.clipped ? ' · Período parcial' : ''}`;
}
export function renderCharts(prefix, rows, selected) {
  clearCharts(prefix);
  if (!rows.length) return;
  if (!globalThis.Chart) {
    selected.textContent = 'Gráficos indisponíveis. Consulte os valores na lista abaixo.';
    return;
  }
  const labels = rows.map(row => row.label || rangeLabel(row));
  const pointRadius = rows.length < 35 ? 2 : 0;
  const datasets = {
    temp: [
      { label: 'Máxima', data: rows.map(r => r.max), borderColor: '#b34528', borderWidth: 1.5, pointRadius, fill: false },
      { label: 'Mínima', data: rows.map(r => r.min), borderColor: '#216491', borderWidth: 1.5, pointRadius, fill: '-1', backgroundColor: 'rgba(28,93,153,.10)' },
      { label: 'Média', data: rows.map(r => r.mean), borderColor: '#995400', borderWidth: 3, pointRadius, fill: false },
    ],
    rain: [{ label: 'Chuva (mm)', data: rows.map(r => r.precip), backgroundColor: '#276ba6', borderRadius: 3 }],
  };
  for (const kind of ['temp', 'rain']) {
    const id = `${prefix}-${kind}`;
    charts.set(id, new Chart(document.getElementById(id), {
      type: kind === 'rain' ? 'bar' : 'line', data: { labels, datasets: datasets[kind] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 13 } } },
          tooltip: { enabled: false } },
        scales: { x: { ticks: { maxTicksLimit: 4, maxRotation: 0, font: { size: 12 } } },
          y: { beginAtZero: kind === 'rain', title: { display: true, text: kind === 'rain' ? 'mm' : '°C' } } },
        onClick: (_event, elements) => { if (elements.length) showSelection(selected, rows[elements[0].index]); },
      },
    }));
  }
  showSelection(selected, rows[rows.length - 1]);
}
export function dailyGroups(rows) {
  return rows.map(row => ({ ...row, ...summarize([row]), start: row.date, end: row.date }));
}
