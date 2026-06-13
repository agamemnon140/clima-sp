/* Dashboard clima-sp: lê os JSONs gerados pelo pipeline e renderiza os blocos. */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun",
               "jul", "ago", "set", "out", "nov", "dez"];

const NOMES_VAR = {
  precipitacao: { titulo: "🌧️ Chuva (trimestre)", unidade: "mm" },
  temperatura: { titulo: "🌡️ Temperatura média", unidade: "°C" },
};

async function carregar(nome) {
  const resp = await fetch(`data/${nome}.json`);
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
       <canvas id="${id}"></canvas></div>`);
    new Chart(document.getElementById(id), {
      type: "line",
      data: {
        labels: idx.serie.map(p => fmtMes(p.mes)),
        datasets: [{ data: idx.serie.map(p => p.valor), borderColor: "#1c5d99",
                     borderWidth: 1.5, pointRadius: 0, fill: false }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { ticks: { font: { size: 9 } } } },
      },
    });
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
    const [prev, skill, indices, meta] = await Promise.all(
      ["previsao", "skill", "indices", "meta"].map(carregar));
    renderPrevisao(prev);
    renderSkill(skill);
    renderIndices(indices);
    renderMeta(meta);
  } catch (err) {
    document.getElementById("previsao-intro").textContent =
      "Erro ao carregar os dados do dashboard: " + err.message;
  }
})();
