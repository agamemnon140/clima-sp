# clima-sp 🌦️

Previsão climática sazonal **probabilística** para a Região Metropolitana de São Paulo (RMSP),
com modelo estatístico próprio, validação honesta e dashboard público.

🌐 **Dashboard**: https://agamemnon140.github.io/clima-sp/

## O que dá (e o que não dá) para prever

Nenhum modelo no mundo — nem os do ECMWF, NOAA ou INPE — prevê o tempo de forma
determinística ("vai chover no dia X") com meses de antecedência. O limite teórico da
previsão de tempo é de ~2 semanas (caos atmosférico). O que existe além disso é
**previsão climática sazonal**: estimar a *probabilidade* de um trimestre inteiro ficar
abaixo, dentro ou acima do normal histórico.

| Horizonte | O que é possível | Habilidade típica (RPSS)* |
|---|---|---|
| **3 meses** | Probabilidades de chuva/temperatura acima ou abaixo do normal, com sinal real — principalmente quando há El Niño ou La Niña ativos | modesta (~0,02–0,04) |
| **6 meses** | Mesmo tipo de previsão, mas só o sinal ENSO mais forte sobrevive | marginal (~0,01–0,02) |
| **12 meses** | Essencialmente climatologia (o que é normal para a época) + tendência de aquecimento. O estado do ENSO nesse horizonte é imprevisível (barreira do outono austral) | ≈ 0 |
| **24 meses** | Idem — a leve inclinação de temperatura para "acima do normal" vem da tendência de aquecimento global, não de previsão real | ≈ 0 |

\* valores medidos por este projeto em validação leave-one-year-out 1979–presente; veja o dashboard.
RPSS = 0 significa "igual a chutar a climatologia"; previsão sazonal de boa qualidade no Sudeste
do Brasil raramente passa de 0,1.

## Principais variáveis (preditores) do modelo

A previsibilidade sazonal vem de componentes lentas do sistema climático — sobretudo a
temperatura da superfície dos oceanos:

- **ONI / Niño 3.4 (ENSO)** — o preditor mais importante para o Brasil; El Niño e La Niña
  modulam a chuva de verão no Sudeste;
- **TSA (Atlântico Sul tropical)** — influencia a posição da ZCAS, principal sistema
  produtor de chuva em SP;
- **DMI (Dipolo do Oceano Índico)** — sinal secundário, mais atuante na primavera;
- **AAO/SAM (Oscilação Antártica)** — modula a passagem de frentes frias;
- **Tendência de aquecimento** — termo linear que captura a mudança climática, dominante
  na "previsibilidade" de temperatura em horizontes longos.

**Alvos**: anomalias de precipitação acumulada e temperatura média em trimestres móveis
(JFM, FMA, …, DJF), no ponto -23,5°S -46,6°O, vs. climatologia 1991–2020.

## Como funciona

1. **Dados** ([src/fetch_indices.py](src/fetch_indices.py), [src/fetch_target.py](src/fetch_target.py)):
   índices mensais da NOAA (PSL/CPC) e série diária ERA5 desde 1940 via
   [Open-Meteo Archive API](https://open-meteo.com/) (a API pública do INMET mostrou-se
   instável para automação; a reanálise ERA5 é o substituto contínuo e auditável).
2. **Dataset** ([src/build_dataset.py](src/build_dataset.py)): para cada mês de inicialização,
   médias trimestrais dos índices → anomalia do trimestre-alvo 3/6/12/24 meses à frente.
3. **Modelo** ([src/model.py](src/model.py)): regressão logística multinomial regularizada
   (probabilidades dos tercis abaixo/normal/acima) + Ridge (anomalia pontual), um modelo
   por variável × horizonte × estação do ano. Probabilidades encolhidas em direção à
   climatologia para evitar superconfiança (C=0,1, shrink=0,6, fixados a priori).
4. **Validação** ([src/hindcast.py](src/hindcast.py)): leave-one-year-out 1979–presente,
   com tercis e padronização recalculados dentro de cada dobra (sem vazamento).
   Métricas: RPSS vs. climatologia e taxa de acerto do tercil mais provável.
5. **Previsão e publicação** ([src/forecast.py](src/forecast.py), [src/export_json.py](src/export_json.py)):
   treina com todo o histórico, prevê com os índices mais recentes e grava os JSONs
   lidos pelo dashboard estático em [docs/](docs/).

## Atualização automática

O workflow [.github/workflows/atualiza-mensal.yml](.github/workflows/atualiza-mensal.yml)
roda todo dia 5 (09:00 UTC): baixa os dados mais novos, refaz hindcast e previsão e
commita os JSONs atualizados — o dashboard se atualiza sozinho. Também pode ser disparado
manualmente na aba Actions.

## Rodando localmente

```bash
pip install -r requirements.txt
python -m src.run_all          # pipeline completo (~2 min)
python -m http.server -d docs  # dashboard em http://localhost:8000
```

## Limitações

- Ponto único de grade ERA5 ≠ rede de estações; extremos locais não são representados.
- Alguns índices chegam com meses de defasagem (o DMI/HadISST em especial); usa-se
  persistência do último valor e a defasagem fica registrada em `docs/data/meta.json`.
- ~46 anos de treino é pouco; os intervalos das probabilidades são largos.
- Este projeto é educacional e **não substitui** as previsões oficiais do
  [CPTEC/INPE](http://clima1.cptec.inpe.br/) e do [INMET](https://portal.inmet.gov.br/).

## Fontes

- Índices: [NOAA PSL](https://psl.noaa.gov/data/climateindices/) (ONI, TSA, DMI) e
  [NOAA CPC](https://www.cpc.ncep.noaa.gov/) (AAO)
- Observações: ERA5 (Copernicus/ECMWF) via [Open-Meteo](https://open-meteo.com/)
- Previsões oficiais linkadas: CPTEC/INPE, NOAA CPC, Copernicus C3S
