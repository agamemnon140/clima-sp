// Pontos com modelo sazonal próprio (abas Tendências e Sobre). São os mesmos de LOCAIS em
// src/config.py: ao mexer aqui, mexa lá. "dados" é a pasta dos JSONs que o pipeline gera.
export const SAO_PAULO = { name: 'São Paulo', region: 'São Paulo', country: 'Brasil', latitude: -23.5, longitude: -46.62, timezone: 'America/Sao_Paulo' };
export const VALINHOS = { name: 'Valinhos', region: 'São Paulo', country: 'Brasil', latitude: -22.97, longitude: -47.0, timezone: 'America/Sao_Paulo' };
export const LOCAIS = [
  { slug: 'sao-paulo', dados: 'data', local: SAO_PAULO },
  { slug: 'valinhos', dados: 'data/valinhos', local: VALINHOS },
];

const RAD = Math.PI / 180;
export function distanciaKm(a, b) {
  const h = Math.sin((b.latitude - a.latitude) * RAD / 2) ** 2 +
    Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin((b.longitude - a.longitude) * RAD / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
export function mesmoPonto(a, b) {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}
// O ponto modelado que vale para a localização: ela própria, se tiver modelo; senão, o mais próximo.
export function modeloPara(location, locais = LOCAIS) {
  let melhor = null;
  for (const item of locais) {
    const km = distanciaKm(location, item.local);
    if (!melhor || km < melhor.distanciaKm) melhor = { ...item, distanciaKm: km };
  }
  return { ...melhor, exato: mesmoPonto(location, melhor.local) };
}
