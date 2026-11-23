# clima-sp 🌦️

Previsão climática sazonal **probabilística** para a Região Metropolitana de São Paulo (RMSP)
e para Valinhos, com modelo estatístico próprio, validação honesta e dashboard público.

🌐 **Dashboard**: https://agamemnon140.github.io/clima-sp/

## Consulta no celular

O dashboard tem quatro abas: **Previsão**, **Histórico**, **Tendências** e **Sobre**.
A barra de local traz atalhos para **São Paulo** e **Valinhos**, os dois pontos com modelo
sazonal próprio, e a busca de qualquer outra cidade. A escolha vale para todas as abas:
Previsão e Histórico consultam a cidade escolhida; Tendências e os painéis do modelo em Sobre
mostram o ponto modelado dela ou, para as demais cidades, o mais próximo, com o aviso e a
distância. No celular, a navegação fica na parte inferior, com áreas de toque de pelo menos 44 px,
gráficos separados de temperatura e chuva e listas de valores que dispensam ampliar a tela.

O Histórico consulta os dados diários ERA5 do Open-Meteo sob demanda e os mostra em
uma matriz de calendário (heatmap) para uma variável por vez: chuva, temperatura média,
mínima, máxima ou horas de sol. Há quatro leituras: **Ano × Mês**, **Ano × Semana**,
**Mês × Dia** e **Semana × Dia**. Chuva é somada; temperatura média e horas de sol são
médias diárias; máxima e mínima são extremos absolutos. Semanas vão de segunda a domingo
e, em Ano × Semana, pertencem ao ano da sua quinta-feira (semana ISO).

Por padrão a matriz mostra os últimos 20 anos civis em Ano × Mês, do ano mais recente
ao mais antigo (as linhas sempre vão do período mais novo para o mais velho). O seletor
de período oferece 1, 5, 10 e 20 anos (anos civis até hoje), Todos (desde 1940) e
Personalizado, que revela as datas livres com navegação para o intervalo anterior e o
próximo. Abrir um mês, semana ou ano pela matriz passa o período para Personalizado.

**Contar dias.** Em "Mostrar", a matriz troca o valor do período pela contagem de dias em que
o valor diário da variável ficou igual ou acima (≥) ou igual ou abaixo (≤) de um limite que
você escolhe: dias com máxima ≥ 30 °C, com mínima ≤ 10 °C, com chuva ≥ 1 mm, dias secos
(chuva ≤ 0 mm), com sol ≥ 8 h. O limite entra no próprio campo ou pelos botões − e +, e cada
variável guarda o seu. A comparação inclui o limite. Acima da matriz aparece o total do
período, com a parcela dos dias com dados; a coluna Total soma cada linha (o ano, em
Ano × Mês). Nas leituras por dia a célula mantém o valor do dia e ganha cor quando atende ao
critério. Dias sem dados não entram na conta, e mudar o limite não refaz a consulta.

As cores usam um gradiente contínuo escalado sobre os valores visíveis na matriz; o máximo
e o mínimo do que está na tela recebem contorno (sólido e tracejado). Dias sem dados aparecem
hachurados com “–”, nunca como zero; dias inexistentes ficam em branco. Cada célula informa,
ao toque ou ao passar o mouse, o período, o valor e a cobertura de dias. Tocar em um mês,
semana ou ano abre seus dias. Não há exportação CSV nem comparação com a normal 1991–2020;
intervalos de vários anos ficam mais legíveis em Ano × Mês ou Ano × Semana.

Os dados ficam em cache por localização, fuso e ano no IndexedDB `clima-history-v2` (seis
horas para os dois anos mais recentes, 30 dias para os anteriores); sem armazenamento
disponível, o app usa cache em memória. Horas de sol vêm de `sunshine_duration` do ERA5,
derivada da radiação (limiar de 120 W/m²), não de heliógrafo. ERA5 é reanálise em grade,
não medição de estação, e tem cerca de cinco dias de defasagem.

**Fonte legada:** o pipeline sazonal existente usa a seleção automática da Archive API,
embora versões anteriores o identificassem como ERA5. A série de Valinhos usa a mesma seleção,
para os dois pontos serem comparáveis. O Histórico novo fixa `models=era5`.
Os metadados foram corrigidos; a série e o modelo sazonais não foram recalculados nesta mudança.
Pode haver diferenças entre as duas fontes. Migrar o modelo sazonal para ERA5 explícito
exige reconstrução completa da série e nova validação, evitando misturar fontes no incremental.

Plano da implementação: [PLANO-MELHORIAS-CLIMA.md](PLANO-MELHORIAS-CLIMA.md).

### Verificação do dashboard

Não há etapa de build: sirva a pasta `docs` com um servidor HTTP, inclusive para testar módulos JS.
Node.js 20+ é usado apenas para testes:

```bash
npm ci
npm run check
npm test
npx playwright install chromium webkit
npm run test:ui
python -m unittest tests.test_fetch_target   # download retomável do pipeline, sem rede
```

Os testes de interface executam os fluxos em Chromium e WebKit com emulação de iPhone,
incluindo largura de 320 px e texto a 200%. Respostas meteorológicas são controladas nos
testes para permitir resultados reproduzíveis; isso não substitui a conferência em um iPhone físico.

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
(JFM, FMA, …, DJF), em cada ponto modelado — São Paulo (-23,50; -46,62) e Valinhos
(-22,97; -47,00) —, vs. climatologia 1991–2020. Cada ponto tem série, modelo e validação
próprios; os índices climáticos são os mesmos.

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

Os pontos modelados estão em `LOCAIS`, em [src/config.py](src/config.py), e espelhados em
[docs/js/locais.mjs](docs/js/locais.mjs) (um teste confere que as duas listas batem). São Paulo
mantém os arquivos na raiz de `data/raw`, `data/processed` e `docs/data`; cada outro local usa
uma subpasta com o próprio nome (`valinhos/`). Para incluir um ponto, acrescente-o às duas
listas: a execução seguinte baixa a série desde 1940 e publica os JSONs.

## Atualização automática

O workflow [.github/workflows/atualiza-mensal.yml](.github/workflows/atualiza-mensal.yml)
roda nos dias 5, 12, 19 e 26 (09:00 UTC): baixa os dados mais novos, refaz hindcast e previsão
de cada local e commita os JSONs atualizados — o dashboard se atualiza sozinho. Também pode
ser disparado manualmente na aba Actions, em qualquer ramo.

A falha de um local não impede os outros: a execução termina marcada como falha, mas o que foi
gerado é commitado. O primeiro download de um local novo (a série inteira desde 1940) vai em
blocos de dez anos espaçados de um minuto, por causa do teto por minuto do Open-Meteo, e é
retomável: se cortar no meio, a execução seguinte continua do último mês gravado, e o local
só entra no modelo com a série completa.

## Rodando localmente

```bash
pip install -r requirements.txt
python -m src.run_all          # pipeline completo, todos os locais (~1 min por local)
python -m src.fetch_target valinhos --full  # refaz a série inteira de um local
python -m http.server -d docs  # dashboard em http://localhost:8000
```

## Limitações

- Um ponto de grade por local ≠ rede de estações; extremos locais não são representados.
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
