/* Dashboard clima-sp: lê os JSONs gerados pelo pipeline e renderiza os blocos. */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun",
               "jul", "ago", "set", "out", "nov", "dez"];

const NOMES_VAR = {
  precipitacao: { titulo: "🌧️ Chuva (trimestre)", unidade: "mm" },
  temperatura: { titulo: "🌡️ Temperatura média", unidade: "°C" },
};

async function carregar(nome) {
  const resp = await fetch(`data/${nome}.json`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`falha ao carregar ${nome}.json`);
  return resp.json();
}

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

const chartsMensais = {};

function renderMensal(mensal, anosHistorico = 2) {
  // recorte do histórico conforme o seletor (0 = série completa desde 1940)
  const corte = anosHistorico > 0 ? anosHistorico * 12 : mensal.historico.meses.length;
  const hist = {
    meses: mensal.historico.meses.slice(-corte),
    precipitacao: mensal.historico.precipitacao.slice(-corte),
    temperatura: mensal.historico.temperatura.slice(-corte),
    climatologia: {
      precipitacao: mensal.historico.climatologia.precipitacao.slice(-corte),
      temperatura: mensal.historico.climatologia.temperatura.slice(-corte),
    },
  };
  const prev = mensal.previsao;
  const labels = [...hist.meses, ...prev.map(p => p.mes)].map(fmtMes);
  const nHist = hist.meses.length;

  const configVar = {
    precipitacao: { canvas: "grafico-chuva", titulo: "Chuva mensal (mm)", cor: "#1c5d99",
                    banda: "rgba(28, 93, 153, .18)", minY: 0 },
    temperatura: { canvas: "grafico-temp", titulo: "Temperatura média mensal (°C)", cor: "#e07b39",
                   banda: "rgba(224, 123, 57, .18)", minY: null },
  };

  for (const [varName, cfg] of Object.entries(configVar)) {
    if (!document.getElementById(cfg.canvas)) continue; // HTML antigo em cache
    if (chartsMensais[cfg.canvas]) chartsMensais[cfg.canvas].destroy();
    // séries com null fora do seu trecho; previsão começa colada no último observado
    const observado = [...hist[varName], ...prev.map(() => null)];
    const esperado = labels.map(() => null);
    const sup = labels.map(() => null);
    const inf = labels.map(() => null);
    esperado[nHist - 1] = hist[varName][nHist - 1];
    prev.forEach((p, i) => {
      const v = p[varName];
      esperado[nHist + i] = v.esperado;
      sup[nHist + i] = v.esperado + v.sigma;
      inf[nHist + i] = Math.max(v.esperado - v.sigma, cfg.minY ?? -Infinity);
    });
    const climatologia = [
      ...hist.climatologia[varName],
      ...prev.map(p => p[varName].climatologia),
    ];

    chartsMensais[cfg.canvas] = new Chart(document.getElementById(cfg.canvas), {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Observado", data: observado, borderColor: cfg.cor,
            borderWidth: 2, pointRadius: 0, fill: false },
          { label: "Esperado (modelo)", data: esperado, borderColor: cfg.cor,
            borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false },
          { label: "+1σ", data: sup, borderWidth: 0, pointRadius: 0, fill: false },
          { label: "Faixa ±1σ", data: inf, borderWidth: 0, pointRadius: 0,
            backgroundColor: cfg.banda, fill: "-1" },
          { label: "Normal 1991–2020", data: climatologia, borderColor: "#9aa7b3",
            borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0, fill: false },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: cfg.titulo },
          legend: { labels: { filter: item => item.text !== "+1σ" } },
          tooltip: { filter: item => item.dataset.label !== "+1σ" },
        },
        scales: {
          y: cfg.minY === null ? {} : { min: cfg.minY },
          x: { ticks: { maxTicksLimit: 16 } },
        },
        interaction: { mode: "index", intersect: false },
      },
    });
  }
}

function ligarSeletor(mensal) {
  const seletor = document.getElementById("seletor-anos");
  if (!seletor) return;
  seletor.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      seletor.querySelectorAll("button").forEach(b => b.classList.remove("ativo"));
      btn.classList.add("ativo");
      renderMensal(mensal, Number(btn.dataset.anos));
    });
  });
}

const NOMES_PREDITORES = {
  oni: "ONI (El Niño/La Niña)",
  tsa: "TSA (Atl. Sul)",
  dmi: "DMI (Índico)",
  aao: "AAO (Antártica)",
  trend: "Tendência (aquecimento)",
};

function renderInfluencias(infl) {
  const cfgs = [
    { var: "precipitacao", canvas: "grafico-infl-chuva", titulo: "Chuva: efeito no trimestre (mm por +1 DP)" },
    { var: "temperatura", canvas: "grafico-infl-temp", titulo: "Temperatura: efeito no trimestre (°C por +1 DP)" },
  ];
  const coresLead = { 3: "#123c63", 6: "#1c5d99", 12: "#6f9cc4", 24: "#b9cfe2" };
  for (const cfg of cfgs) {
    const el = document.getElementById(cfg.canvas);
    if (!el) continue;
    const dados = infl[cfg.var];
    const features = Object.keys(NOMES_PREDITORES);
    new Chart(el, {
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
        scales: { x: { ticks: { font: { size: 10 } } } },
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
  const el = document.getElementById("grafico-anual");
  if (!el) return;
  const taxa = anual.taxa_aquecimento_decada;
  const total = (taxa * (anual.anos.at(-1) - anual.taxa_desde) / 10).toFixed(1);
  document.getElementById("aquecimento-texto").innerHTML =
    `A temperatura média anual no ponto da RMSP sobe <strong>${taxa.toFixed(2).replace(".", ",")} °C por década</strong>
     desde ${anual.taxa_desde} (≈ ${String(total).replace(".", ",")} °C acumulados) — a linha escura é a média móvel
     de 10 anos, que filtra o sobe-e-desce de El Niño/La Niña e deixa a tendência à mostra.
     É este sinal que o termo "tendência" do modelo captura, e é ele que inclina as previsões
     longas de temperatura para "acima do normal".`;
  new Chart(el, {
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
      plugins: { title: { display: true, text: "Temperatura média anual — RMSP (ERA5, 1940–presente)" } },
      scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: "°C" } } },
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

  cont.insertAdjacentHTML("afterend",
    `<p class="legenda">Cores: <i style="background:var(--abaixo)"></i> abaixo do normal
     <i style="background:var(--normal)"></i> dentro do normal
     <i style="background:var(--acima)"></i> acima do normal.
     Com habilidade baixa, as barras ficam próximas de 33/33/33 — isso é o resultado honesto.</p>`);
}

function renderSkill(skill) {
  const leads = [...new Set(skill.map(s => s.lead))].sort((a, b) => a - b);
  const porVar = v => leads.map(l =>
    (skill.find(s => s.var === v && s.lead === l) || {}).rpss ?? null);

  new Chart(document.getElementById("grafico-skill"), {
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
  document.getElementById("atualizacao").textContent = `Última atualização: ${quando} (UTC)`;
  const defas = Object.entries(meta.defasagens_indices_meses)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}m`).join(" · ");
  document.getElementById("meta-rodape").textContent =
    `Treino ${meta.periodo_treino} · climatologia ${meta.climatologia} · alvo ${meta.fonte_alvo} ` +
    `(${meta.coordenadas.lat}, ${meta.coordenadas.lon}) · defasagem dos índices — ${defas}`;
}

(async () => {
  try {
    const [prev, mensal, infl, anual, skill, indices, meta] = await Promise.all(
      ["previsao", "mensal", "influencias", "anual", "skill", "indices", "meta"].map(carregar));
    // cada bloco isolado: a falha de um não derruba os demais
    const blocos = [
      [renderMensal, mensal], [ligarSeletor, mensal], [renderInfluencias, infl],
      [renderAnual, anual], [renderPrevisao, prev], [renderSkill, skill],
      [renderIndices, indices], [renderMeta, meta],
    ];
    for (const [fn, dados] of blocos) {
      try { fn(dados); } catch (err) { console.error(fn.name, err); }
    }
  } catch (err) {
    document.getElementById("previsao-intro").textContent =
      "Erro ao carregar os dados do dashboard: " + err.message;
  }
})();
