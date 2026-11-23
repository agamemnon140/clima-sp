import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distanciaKm, LOCAIS, modeloPara, SAO_PAULO, VALINHOS } from '../docs/js/locais.mjs';

test('cidade com modelo próprio é o seu próprio ponto', () => {
  const sp = modeloPara(SAO_PAULO);
  assert.equal(sp.slug, 'sao-paulo');
  assert.equal(sp.dados, 'data');
  assert.equal(sp.exato, true);
  assert.equal(sp.distanciaKm, 0);
  const valinhos = modeloPara({ ...VALINHOS, name: 'salvo com outro nome' });
  assert.equal(valinhos.slug, 'valinhos');
  assert.equal(valinhos.dados, 'data/valinhos');
  assert.equal(valinhos.exato, true);
});

test('cidade sem modelo cai no ponto mais próximo, com a distância', () => {
  const campinas = modeloPara({ latitude: -22.9, longitude: -47.06 });
  assert.equal(campinas.slug, 'valinhos');
  assert.equal(campinas.exato, false);
  assert.ok(campinas.distanciaKm > 5 && campinas.distanciaKm < 15, String(campinas.distanciaKm));
  const santos = modeloPara({ latitude: -23.96, longitude: -46.33 });
  assert.equal(santos.slug, 'sao-paulo');
  assert.equal(santos.exato, false);
  const entre = distanciaKm(SAO_PAULO, VALINHOS);
  assert.ok(entre > 65 && entre < 75, String(entre)); // ~70 km em linha reta
});

test('os pontos do app são os mesmos do pipeline (src/config.py)', async () => {
  const config = await readFile(new URL('../src/config.py', import.meta.url), 'utf8');
  const emPython = [...config.matchAll(/Local\("([\w-]+)", "[^"]+", (-?[\d.]+), (-?[\d.]+)(?:, subpasta="([\w-]+)")?\)/g)]
    .map(([, slug, lat, lon, subpasta]) => ({ slug, latitude: Number(lat), longitude: Number(lon), dados: subpasta ? `data/${subpasta}` : 'data' }));
  assert.deepEqual(emPython, LOCAIS.map(item => ({ slug: item.slug, latitude: item.local.latitude, longitude: item.local.longitude, dados: item.dados })));
});
