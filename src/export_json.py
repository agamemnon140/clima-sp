"""Gera os JSONs consumidos pelo dashboard em docs/data/ (um conjunto por local).

Os índices climáticos são os mesmos para todos os locais e ficam em docs/data/indices.json.
"""
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import build_dataset, config, forecast, model, monthly, registro


def _write(pasta, name: str, obj) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    path = pasta / name
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{path.relative_to(config.BASE_DIR).as_posix()} gravado")


def export_previsao(forecast_result: dict, local: config.Local = config.PADRAO) -> None:
    _write(local.docs_data_dir, "previsao.json", forecast_result)


def export_skill(local: config.Local = config.PADRAO) -> None:
    skill = pd.read_csv(local.processed_dir / "skill.csv")
    _write(local.docs_data_dir, "skill.json", skill.to_dict(orient="records"))


def export_indices() -> dict:
    out = {}
    lags = {}
    for name, spec in config.INDICES.items():
        df = build_dataset.load_monthly(name).sort_values(["year", "month"]).tail(24)
        out[name] = {
            "nome": spec["nome"],
            "descricao": spec["descricao"],
            "serie": [{"mes": f"{int(r.year)}-{int(r.month):02d}", "valor": round(r.value, 2)}
                      for r in df.itertuples()],
            "ultimo": round(float(df["value"].iloc[-1]), 2),
        }
    oni = out["oni"]["ultimo"]
    estado = "El Niño" if oni >= 0.5 else ("La Niña" if oni <= -0.5 else "Neutro")
    out["enso"] = {"estado": estado, "oni": oni}
    _write(config.DOCS_DATA_DIR, "indices.json", out)
    return out


def export_meta(forecast_result: dict, local: config.Local = config.PADRAO) -> None:
    skill = pd.read_csv(local.processed_dir / "skill.csv")
    meta = {
        "local": local.nome,
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "periodo_treino": f"{config.TRAIN_START_YEAR}-presente",
        "climatologia": f"{config.CLIMATOLOGY_START}-{config.CLIMATOLOGY_END}",
        "fonte_alvo": "Open-Meteo Archive API (selecao automatica de modelos)",
        "coordenadas": {"lat": local.latitude, "lon": local.longitude},
        "defasagens_indices_meses": forecast_result["defasagens_meses"],
        "n_hindcast": int(skill["n"].sum()),
    }
    _write(local.docs_data_dir, "meta.json", meta)


def export_mensal(local: config.Local = config.PADRAO) -> None:
    _write(local.docs_data_dir, "mensal.json", monthly.run(local))


def export_influencias(local: config.Local = config.PADRAO) -> None:
    """Coeficientes padronizados do Ridge: efeito de +1 desvio padrão de cada
    preditor sobre a anomalia do trimestre, em unidades físicas (mm ou °C),
    médios sobre as 12 estações do ano."""
    ds = pd.read_csv(local.processed_dir / "dataset.csv")
    out = {}
    for var in config.VARIABLES:
        out[var] = {}
        for lead in config.LEADS:
            coefs = []
            sub = ds[(ds["var"] == var) & (ds["lead"] == lead)]
            for _, grp in sub.groupby("season_month"):
                reg = model.fit_anomaly_model(grp[config.FEATURES], grp["anomaly"])
                coefs.append(reg[-1].coef_)
            mean_coef = np.mean(coefs, axis=0)
            out[var][str(lead)] = {f: round(float(c), 3)
                                   for f, c in zip(config.FEATURES, mean_coef)}
    _write(local.docs_data_dir, "influencias.json", out)


def export_anual(local: config.Local = config.PADRAO) -> None:
    """Médias anuais (anos completos) e taxa de aquecimento — onde a mudança
    climática fica visível a olho nu."""
    m = build_dataset.load_alvo(local)
    full = m.groupby("year").filter(lambda g: len(g) == 12)
    annual = full.groupby("year").agg(precip=("precip", "sum"),
                                      temp=("temp", "mean")).reset_index()
    recente = annual[annual["year"] >= config.TRAIN_START_YEAR]
    taxa = float(np.polyfit(recente["year"], recente["temp"], 1)[0] * 10)
    _write(local.docs_data_dir, "anual.json", {
        "anos": annual["year"].astype(int).tolist(),
        "temp": [round(v, 2) for v in annual["temp"]],
        "precip": [round(v, 0) for v in annual["precip"]],
        "taxa_aquecimento_decada": round(taxa, 2),
        "taxa_desde": config.TRAIN_START_YEAR,
    })


def export_local(local: config.Local = config.PADRAO) -> None:
    """JSONs de um local (tudo, menos os índices, que são comuns)."""
    result = forecast.run(local)
    export_previsao(result, local)
    export_mensal(local)
    export_influencias(local)
    export_anual(local)
    export_skill(local)
    export_meta(result, local)
    registro.atualizar(result, local)


def export_all() -> None:
    export_indices()
    for local in config.LOCAIS:
        export_local(local)


if __name__ == "__main__":
    export_all()
