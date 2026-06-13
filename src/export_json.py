"""Gera os JSONs consumidos pelo dashboard em docs/data/."""
import json
from datetime import datetime, timezone

import pandas as pd

from . import build_dataset, config, forecast, monthly


def _write(name: str, obj) -> None:
    config.DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = config.DOCS_DATA_DIR / name
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"docs/data/{name} gravado")


def export_previsao(forecast_result: dict) -> None:
    _write("previsao.json", forecast_result)


def export_skill() -> None:
    skill = pd.read_csv(config.PROCESSED_DIR / "skill.csv")
    _write("skill.json", skill.to_dict(orient="records"))


def export_indices() -> dict:
    out = {}
    lags = {}
    for name, spec in config.INDICES.items():
        df = build_dataset.load_monthly(name).sort_values(["year", "month"]).tail(24)
        out[name] = {
            "nome": spec["nome"],
            "serie": [{"mes": f"{int(r.year)}-{int(r.month):02d}", "valor": round(r.value, 2)}
                      for r in df.itertuples()],
            "ultimo": round(float(df["value"].iloc[-1]), 2),
        }
    oni = out["oni"]["ultimo"]
    estado = "El Niño" if oni >= 0.5 else ("La Niña" if oni <= -0.5 else "Neutro")
    out["enso"] = {"estado": estado, "oni": oni}
    _write("indices.json", out)
    return out


def export_meta(forecast_result: dict) -> None:
    skill = pd.read_csv(config.PROCESSED_DIR / "skill.csv")
    meta = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "periodo_treino": f"{config.TRAIN_START_YEAR}-presente",
        "climatologia": f"{config.CLIMATOLOGY_START}-{config.CLIMATOLOGY_END}",
        "fonte_alvo": "ERA5 via Open-Meteo Archive API",
        "coordenadas": {"lat": config.LATITUDE, "lon": config.LONGITUDE},
        "defasagens_indices_meses": forecast_result["defasagens_meses"],
        "n_hindcast": int(skill["n"].sum()),
    }
    _write("meta.json", meta)


def export_mensal() -> None:
    _write("mensal.json", monthly.run())


def export_all() -> None:
    result = forecast.run()
    export_previsao(result)
    export_mensal()
    export_skill()
    export_indices()
    export_meta(result)


if __name__ == "__main__":
    export_all()
