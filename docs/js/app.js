/* Dashboard clima-sp: lê os JSONs gerados pelo pipeline e renderiza os blocos.
   Os painéis do modelo sazonal existem por ponto modelado (São Paulo, Valinhos…): explorer.mjs
   avisa qual vale para a cidade escolhida pelo evento "clima:modelo" e os painéis são refeitos. */

if (globalThis.Chart) {
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.font.size = 14;
  Chart.defaults.color = '#405568';
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun",
               "jul", "ago", "set", "out", "nov", "dez"];

const NOMES_VAR = {
  precipitacao: { titulo: "🌧️ Chuva (trimestre)", unidade: "mm" },
  temperatura: { titulo: "🌡️ Temperatura média", unidade: "°C" },
};

async function carregar(nome, pasta = "data") {
  const resp = await fetch(`${pasta}/${nome}.json`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`falha ao carregar ${nome}.json`);
  return resp.json();
}

// Um gráfico por canvas: refazer um painel destrói o gráfico anterior.
const graficos = {};
function grafico(id, config) {
  graficos[id]?.destroy();
  delete graficos[id];
  const el = document.getElementById(id);
  if (!el) return null; // HTML antigo em cache
  graficos[id] = new Chart(el, config);
  return graficos[id];
}
function apagarGrafico(id) {
  graficos[id]?.destroy();
  delete graficos[id];
}

// Ponto modelado em exibição; o padrão vale se explorer.mjs não carregar.
const MODELO_PADRAO = { slug: "sao-paulo", nome: "São Paulo", dados: "data",
                        latitude: -23.5, longitude: -46.62, exato: true };
let modelo = null;

function fmtMes(iso) {
  const [ano, mes] = iso.split("-").map(Number);
  return `${MESES[mes - 1]}/${ano}`;
}

function barraProbs(v) {
  const segs = [
    ["abaixo", v.p_abaixo], ["normal", v.p_normal], ["acima", v.p_acima],
  ];
  const html = segs.map(([cls, p]) =>
    `<span class="seg-${cls}" style="flex:${p}" title="${cls}: ${(p * 100).toFixed(0)}%">${(p * 100).toFixed(0)}%</span>`
  ).join("");
  return `<div class="barra">${html}</div>`;
}

const NOMES_MES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
                   "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Reduz histórico e previsão a uma lista uniforme de pontos {rotulo, var → valores}.
// modo "continuo": recorta os últimos N anos. modo "mes": só o mês escolhido, 1 ponto/ano.
function pontosHistorico(mensal, { anos, mes }) {
  const h = mensal.historico;
  let idx = h.meses.map((_, i) => i);
  if (mes) idx = idx.filter(i => h.meses[i].endsWith("-" + mes));
  else if (anos > 0) idx = idx.slice(-anos * 12);
  return idx.map(i => ({
    rotulo: mes ? h.meses[i].slice(0, 4) : fmtMes(h.meses[i]),
    precipitacao: h.precipitacao[i],
    temperatura: h.temperatura[i],
    clim: { precipitacao: h.climatologia.precipitacao[i], temperatura: h.climatologia.temperatura[i] },
  }));
}

function pontosPrevisao(mensal, { mes }) {
  let p = mensal.previsao;
  if (mes) p = p.filter(e => e.mes.endsWith("-" + mes));
  return p.map(e => ({ rotulo: mes ? e.mes.slice(0, 4) : fmtMes(e.mes), ...e }));
}

function renderMensal(mensal, { anos = 2, mes = null } = {}) {
  const hp = pontosHistorico(mensal, { anos, mes });
  const pp = pontosPrevisao(mensal, { mes });
  const labels = [...hp.map(x => x.rotulo), ...pp.map(x => x.rotulo)];
  const nHist = hp.length;
  const ptRaio = mes ? 3 : 0; // no modo mês há poucos pontos: mostra os marcadores

  const configVar = {
    precipitacao: { canvas: "grafico-chuva", base: "Chuva (mm)", cor: "#1c5d99",
                    banda: "rgba(28, 93, 153, .18)", minY: 0 },
    temperatura: { canvas: "grafico-temp", base: "Temperatura média (°C)", cor: "#e07b39",
                   banda: "rgba(224, 123, 57, .18)", minY: null },
  };

  for (const [varName, cfg] of Object.entries(configVar)) {
    // séries com null fora do seu trecho; previsão começa colada no último observado
    const observado = [...hp.map(x => x[varName]), ...pp.map(() => null)];
    const esperado = labels.map(() => null);
    const sup = labels.map(() => null);
    const inf = labels.map(() => null);
    if (nHist > 0) esperado[nHist - 1] = hp[nHist - 1][varName];
    pp.forEach((p, i) => {
      const v = p[varName];
      esperado[nHist + i] = v.esperado;
      sup[nHist + i] = v.esperado + v.sigma;
      inf[nHist + i] = Math.max(v.esperado - v.sigma, cfg.minY ?? -Infinity);
    });
    const climatologia = [
      ...hp.map(x => x.clim[varName]),
      ...pp.map(p => p[varName].climatologia),
    ];

    const titulo = mes
      ? `${cfg.base} — só ${NOMES_MES[Number(mes)]}, ano a ano`
      : `${cfg.base} mensal`;

    grafico(cfg.canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Reanálise", data: observado, borderColor: cfg.cor,
            borderWidth: 2, pointRadius: ptRaio, fill: false },
          { label: "Esperado (modelo)", data: esperado, borderColor: cfg.cor,
            borderDash: [6, 4], borderWidth: 2, pointRadius: ptRaio, fill: false },
          { label: "+1σ", data: sup, borderWidth: 0, pointRadius: 0, fill: false },
          { label: "Faixa ±1σ", data: inf, borderWidth: 0, pointRadius: 0,
            backgroundColor: cfg.banda, fill: "-1" },
          { label: "Normal 1991–2020", data: climatologia, borderColor: "#9aa7b3",
            borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0, fill: false },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: titulo },
          legend: { labels: { filter: item => item.text !== "+1σ" } },
          tooltip: { filter: item => item.dataset.label !== "+1σ" },
        },
        scales: {
          y: cfg.minY === null ? {} : { min: cfg.minY },
          x: { ticks: { maxTicksLimit: 5, maxRotation: 0 } },
        },
        interaction: { mode: "index", intersect: false },
      },
    });
  }
}

// Os seletores valem para qualquer ponto: trocar de cidade mantém o recorte escolhido.
const estadoMensal = { anos: 2, mes: null, dados: null };
function atualizarMensal() {
  if (estadoMensal.dados) renderMensal(estadoMensal.dados, { anos: estadoMensal.anos, mes: estadoMensal.mes });
  document.getElementById("seletor-anos")?.classList.toggle("desativado", !!estadoMensal.mes);
}
function ligarSeletores() {
  const seletorAnos = document.getElementById("seletor-anos");
  const seletorMes = document.getElementById("seletor-mes");
  seletorAnos?.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      seletorAnos.querySelectorAll("button").forEach(b => b.classList.remove("ativo"));
      btn.classList.add("ativo");
      estadoMensal.anos = Number(btn.dataset.anos);
      atualizarMensal();
    });
  });
  seletorMes?.addEventListener("change", () => {
    estadoMensal.mes = seletorMes.value || null;
    atualizarMensal();
  });
}
ligarSeletores();

const NOMES_PREDITORES = {
  oni: "ONI (El Niño/La Niña)",
  tsa: "TSA (Atl. Sul)",
  dmi: "DMI (Índico)",
  aao: "AAO (Antártica)",
  trend: "Tendência (aquecimento)",
  persist: "Persistência (mês recente)",
};

function renderLog(log) {
  const el = document.getElementById("tabela-log");
  if (!el) return;
  el.innerHTML = "";
  if (!log.length) return;
  const sinal = v => (v >= 0 ? "+" : "") + v;
  const fmtData = iso => new Date(iso).toLocaleDateString("pt-BR");
  const linhas = log.map(e => {
    const r = e.resumo;
    const cls = e.enso === "Neutro" ? "enso-neutro" : (e.enso === "El Niño" ? "enso-nino" : "enso-nina");
    const tend = (r.chuva.p_acima > r.chuva.p_abaixo) ? "chuva ↑" : "chuva ↓";
    return `<tr>
      <td>${fmtMes(e.mes)}</td>
      <td>${sinal(e.indices.oni)}</td><td>${sinal(e.indices.tsa)}</td>
      <td>${sinal(e.indices.dmi)}</td><td>${sinal(e.indices.aao)}</td>
      <td><span class="estado-enso ${cls}">${e.enso}</span></td>
      <td>${r.estacao}: ${tend}, temp ${r.temperatura.p_acima > r.temperatura.p_abaixo ? "↑" : "↓"}</td>
      <td class="quando">${fmtData(e.gerado_em)}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<table class="log"><tr>
    <th>Inicialização</th><th>ONI</th><th>TSA</th><th>DMI</th><th>AAO</th>
    <th>ENSO</th><th>Previsão (lead 3m)</th><th>Capturado em</th></tr>${linhas}</table>`;
}

function renderInfluencias(infl) {
  const cfgs = [
    { var: "precipitacao", canvas: "grafico-infl-chuva", titulo: "Chuva: efeito no trimestre (mm por +1 DP)" },
    { var: "temperatura", canvas: "grafico-infl-temp", titulo: "Temperatura: efeito no trimestre (°C por +1 DP)" },
  ];
  const coresLead = { 3: "#123c63", 6: "#1c5d99", 12: "#6f9cc4", 24: "#b9cfe2" };
  for (const cfg of cfgs) {
    const dados = infl[cfg.var];
    const features = Object.keys(NOMES_PREDITORES);
    grafico(cfg.canvas, {
      type: "bar",
      data: {
        labels: features.map(f => NOMES_PREDITORES[f]),
        datasets: Object.keys(dados).map(lead => ({
          label: `+${lead} meses`,
          data: features.map(f => dados[lead][f]),
          backgroundColor: coresLead[lead] || "#888",
        })),
      },
      options: {
        plugins: { title: { display: true, text: cfg.titulo } },
        scales: { x: { ticks: { font: { size: 13 } } } },
      },
    });
  }
}

function mediaMovel(valores, janela) {
  return valores.map((_, i) => {
    if (i < janela - 1) return null;
    const fatia = valores.slice(i - janela + 1, i + 1);
    return fatia.reduce((a, b) => a + b, 0) / janela;
  });
}

function renderAnual(anual) {
  if (!document.getElementById("grafico-anual")) return;
  const taxa = anual.taxa_aquecimento_decada;
  const total = (taxa * (anual.anos.at(-1) - anual.taxa_desde) / 10).toFixed(1);
  document.getElementById("aquecimento-texto").innerHTML =
    `A temperatura média anual no ponto de ${modelo.nome} sobe <strong>${taxa.toFixed(2).replace(".", ",")} °C por década</strong>
     desde ${anual.taxa_desde} (≈ ${String(total).replace(".", ",")} °C acumulados) — a linha escura é a média móvel
     de 10 anos, que filtra o sobe-e-desce de El Niño/La Niña e deixa a tendência à mostra.
     É este sinal que o termo "tendência" do modelo captura, e é ele que inclina as previsões
     longas de temperatura para "acima do normal".`;
  grafico("grafico-anual", {
    type: "line",
    data: {
      labels: anual.anos,
      datasets: [
        { label: "Temperatura média anual", data: anual.temp, borderColor: "rgba(224,123,57,.45)",
          borderWidth: 1.5, pointRadius: 0, fill: false },
        { label: "Média móvel 10 anos", data: mediaMovel(anual.temp, 10), borderColor: "#c0392b",
          borderWidth: 2.5, pointRadius: 0, fill: false },
      ],
    },
    options: {
      plugins: { title: { display: true, text: `Temperatura média anual — ${modelo.nome} (Open-Meteo, 1940–presente)` } },
      scales: { x: { ticks: { maxTicksLimit: 5, maxRotation: 0 } }, y: { title: { display: true, text: "°C" } } },
      interaction: { mode: "index", intersect: false },
    },
  });
}

function renderPrevisao(prev) {
  document.getElementById("previsao-intro").innerHTML =
    `Inicializada em <strong>${fmtMes(prev.inicializacao)}</strong> com os índices mais recentes ` +
    `(ONI ${prev.indices_usados.oni >= 0 ? "+" : ""}${prev.indices_usados.oni}). ` +
    `Probabilidades de cada trimestre ficar <em>abaixo</em>, <em>dentro</em> ou <em>acima</em> do normal 1991–2020.`;

  const cont = document.getElementById("cards-previsao");
  cont.innerHTML = prev.previsoes.map(p => {
    const blocos = Object.entries(p.variaveis).map(([varName, v]) => {
      const meta = NOMES_VAR[varName];
      const sinal = v.anomalia >= 0 ? "+" : "";
      return `<h4>${meta.titulo}</h4>
        ${barraProbs(v)}
        <p class="detalhe">normal: ${v.climatologia} ${meta.unidade} · anomalia estimada: ${sinal}${v.anomalia} ${meta.unidade}</p>`;
    }).join("");
    return `<div class="card">
      <h3>+${p.lead} meses</h3>
      <p class="alvo">trimestre ${p.estacao} ${p.ano} (início ${fmtMes(p.inicio)})</p>
      ${blocos}
    </div>`;
  }).join("");
}

function renderSkill(skill) {
  const leads = [...new Set(skill.map(s => s.lead))].sort((a, b) => a - b);
  const porVar = v => leads.map(l =>
    (skill.find(s => s.var === v && s.lead === l) || {}).rpss ?? null);

  grafico("grafico-skill", {
    type: "bar",
    data: {
      labels: leads.map(l => `+${l} meses`),
      datasets: [
        { label: "Chuva", data: porVar("precipitacao"), backgroundColor: "#1c5d99" },
        { label: "Temperatura", data: porVar("temperatura"), backgroundColor: "#e07b39" },
      ],
    },
    options: {
      scales: {
        y: {
          title: { display: true, text: "RPSS (0 = climatologia)" },
          suggestedMin: -0.05, suggestedMax: 0.15,
        },
      },
    },
  });

  const linhas = skill.map(s =>
    `<tr><td>${s.var === "precipitacao" ? "Chuva" : "Temperatura"}</td><td>+${s.lead}m</td>
     <td>${s.rpss.toFixed(3)}</td><td>${(s.hit_rate * 100).toFixed(1)}%</td><td>${s.n}</td></tr>`).join("");
  document.getElementById("tabela-skill").innerHTML =
    `<table><tr><th>Variável</th><th>Horizonte</th><th>RPSS</th><th>Acerto do tercil (ref.: 33%)</th><th>N</th></tr>${linhas}</table>`;
}

function renderIndices(indices) {
  const enso = indices.enso;
  const cls = enso.estado === "Neutro" ? "enso-neutro"
    : (enso.estado === "El Niño" ? "enso-nino" : "enso-nina");
  document.getElementById("enso-estado").innerHTML =
    `Estado atual do ENSO: <span class="estado-enso ${cls}">${enso.estado}</span> (ONI ${enso.oni >= 0 ? "+" : ""}${enso.oni} °C)`;

  const cont = document.getElementById("cards-indices");
  for (const [key, idx] of Object.entries(indices)) {
    if (key === "enso") continue;
    const id = `mini-${key}`;
    cont.insertAdjacentHTML("beforeend",
      `<div class="card-indice"><h3>${idx.nome}</h3>
       <p class="valor">${idx.ultimo >= 0 ? "+" : ""}${idx.ultimo}</p>
       <canvas id="${id}"></canvas>
       <p class="descricao">${idx.descricao || ""}</p></div>`);
    const labels = idx.serie.map(p => fmtMes(p.mes));
    const datasets = [{ label: idx.nome, data: idx.serie.map(p => p.valor),
                        borderColor: "#1c5d99", borderWidth: 1.5, pointRadius: 0, fill: false }];
    if (key === "oni") {
      // limiares oficiais da NOAA: ONI >= +0,5 = El Niño, <= -0,5 = La Niña
      datasets.push(
        { label: "limiar El Niño (+0,5)", data: labels.map(() => 0.5),
          borderColor: "rgba(192, 98, 43, .8)", borderDash: [4, 3], borderWidth: 1, pointRadius: 0, fill: false },
        { label: "limiar La Niña (-0,5)", data: labels.map(() => -0.5),
          borderColor: "rgba(28, 93, 153, .8)", borderDash: [4, 3], borderWidth: 1, pointRadius: 0, fill: false });
    }
    new Chart(document.getElementById(id), {
      type: "line",
      data: { labels, datasets },
      options: {
        plugins: { legend: { display: false },
                   tooltip: { filter: item => item.datasetIndex === 0 } },
        scales: { x: { display: false }, y: { ticks: { font: { size: 9 } } } },
      },
    });
    if (key === "oni") {
      document.getElementById(id).insertAdjacentHTML("afterend",
        `<p class="limiares">— — acima de <span style="color:var(--abaixo)">+0,5 = El Niño</span> ·
         abaixo de <span style="color:var(--azul)">-0,5 = La Niña</span></p>`);
    }
  }
}

function renderMeta(meta) {
  const quando = new Date(meta.gerado_em).toLocaleString("pt-BR");
  document.getElementById("atualizacao").textContent = `Última atualização sazonal de ${modelo.nome}: ${quando} (seu horário local)`;
  const defas = Object.entries(meta.defasagens_indices_meses)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}m`).join(" · ");
  document.getElementById("meta-rodape").textContent =
    `Treino ${meta.periodo_treino} · climatologia ${meta.climatologia} · alvo ${meta.fonte_alvo} ` +
    `(${meta.coordenadas.lat}, ${meta.coordenadas.lon}) · defasagem dos índices — ${defas}`;
}

// Cada arquivo e painel é independente, inclusive a previsão ao vivo em explorer.mjs.
async function carregarPaineis(tarefas, pasta, vigente = () => true) {
  await Promise.allSettled(tarefas.map(async ([nome, render, alvo]) => {
    try {
      const dados = await carregar(nome, pasta);
      if (vigente()) render(dados);
    } catch (error) {
      if (!vigente()) return;
      const message = document.createElement("p");
      message.className = "panel-error";
      message.dataset.painel = nome;
      message.textContent = `Não foi possível carregar este painel. Recarregue a página para tentar novamente. (${nome})`;
      document.getElementById(alvo)?.before(message);
      console.error(nome, error);
    }
  }));
}

// Painéis do ponto modelado: refeitos a cada troca de cidade.
const PAINEIS_DO_MODELO = [
  ["mensal", dados => { estadoMensal.dados = dados; atualizarMensal(); }, "seletor-anos"],
  ["influencias", renderInfluencias, "grafico-infl-chuva"],
  ["anual", renderAnual, "aquecimento-texto"],
  ["previsao", renderPrevisao, "previsao-intro"],
  ["skill", renderSkill, "tabela-skill"],
  ["meta", renderMeta, "atualizacao"],
  ["log", renderLog, "tabela-log"],
];
const GRAFICOS_DO_MODELO = ["grafico-chuva", "grafico-temp", "grafico-infl-chuva", "grafico-infl-temp",
                            "grafico-anual", "grafico-skill"];
const TEXTOS_DO_MODELO = ["aquecimento-texto", "previsao-intro", "cards-previsao", "tabela-skill",
                          "tabela-log", "atualizacao", "meta-rodape"];

// Nada do ponto anterior fica na tela enquanto o novo carrega ou se um arquivo dele faltar.
function limparPaineisDoModelo() {
  GRAFICOS_DO_MODELO.forEach(apagarGrafico);
  for (const id of TEXTOS_DO_MODELO) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  }
  document.querySelectorAll(".panel-error[data-painel]").forEach(el => {
    if (PAINEIS_DO_MODELO.some(([nome]) => nome === el.dataset.painel)) el.remove();
  });
  estadoMensal.dados = null;
}

const fmtCoord = v => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function descreverModelo(d) {
  const texto = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
  const ponto = `${d.nome} (${fmtCoord(d.latitude)}; ${fmtCoord(d.longitude)})`;
  texto("trends-title", `Tendências · ${d.nome}`);
  if (d.exato) {
    texto("trends-scope", `Modelo sazonal ajustado ao ponto de ${ponto}.`);
    texto("about-scope", `Os painéis do modelo abaixo se referem a ${d.nome}.`);
    return;
  }
  const km = Math.max(1, Math.round(d.distanciaKm)).toLocaleString("pt-BR");
  // Anomalias sazonais são parecidas em escala regional; além disso, o ponto vizinho não diz nada.
  const alcance = d.distanciaKm > 300 ? ` A essa distância, estas tendências não valem para ${d.local}.` : "";
  texto("trends-scope", `Não há modelo sazonal para ${d.local}. Mostrando o ponto modelado mais próximo: ${ponto}, a cerca de ${km} km.${alcance}`);
  texto("about-scope", `Os painéis do modelo abaixo se referem a ${d.nome}, o ponto modelado mais próximo de ${d.local}.`);
}

let carga = 0;
function mostrarModelo(d) {
  const trocou = !modelo || modelo.slug !== d.slug;
  modelo = d;
  descreverModelo(d);
  if (!trocou) return;
  const estaCarga = ++carga;
  limparPaineisDoModelo();
  carregarPaineis(PAINEIS_DO_MODELO, d.dados, () => estaCarga === carga);
}

document.addEventListener("clima:modelo", event => mostrarModelo(event.detail));
if (globalThis.climaModelo) mostrarModelo(globalThis.climaModelo);
// Sem explorer.mjs (módulos indisponíveis ou falha de carga), fica o ponto padrão.
window.addEventListener("load", () => { if (!modelo) mostrarModelo(MODELO_PADRAO); });

// Os índices climáticos são os mesmos para todos os pontos: carregados uma vez.
carregarPaineis([["indices", renderIndices, "enso-estado"]], "data");

const now = new Date();
let nextUpdate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5, 9));
if (nextUpdate <= now) nextUpdate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 5, 9));
const nextLabel = document.getElementById('proxima-atualizacao');
if (nextLabel) nextLabel.textContent = nextUpdate.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) + ', às 09:00 UTC';
