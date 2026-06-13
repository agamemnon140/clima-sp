"""Mantém um log do que cada execução do pipeline capturou (docs/data/log.json).

Uma entrada por mês de inicialização (upsert): re-rodar no mesmo mês substitui
a entrada. O robô mensal commita o arquivo, formando o histórico de atualizações.
"""
import json
from datetime import datetime, timezone

from . import config


def estado_enso(oni: float) -> str:
    return "El Niño" if oni >= 0.5 else ("La Niña" if oni <= -0.5 else "Neutro")


def _resumo_lead3(forecast_result: dict) -> dict:
    p = forecast_result["previsoes"][0]  # LEADS[0] == 3 meses
    return {
        "estacao": f"{p['estacao']} {p['ano']}",
        "chuva": p["variaveis"]["precipitacao"],
        "temperatura": p["variaveis"]["temperatura"],
    }


def atualizar(forecast_result: dict) -> None:
    path = config.DOCS_DATA_DIR / "log.json"
    config.DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    log = []
    if path.exists():
        log = json.loads(path.read_text(encoding="utf-8"))

    idx = forecast_result["indices_usados"]
    entrada = {
        "mes": forecast_result["inicializacao"],
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "indices": {k: idx[k] for k in ("oni", "tsa", "dmi", "aao")},
        "defasagens_meses": forecast_result["defasagens_meses"],
        "enso": estado_enso(idx["oni"]),
        "resumo": _resumo_lead3(forecast_result),
    }

    log = [e for e in log if e["mes"] != entrada["mes"]]  # upsert por mês
    log.append(entrada)
    log.sort(key=lambda e: e["mes"], reverse=True)
    path.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"docs/data/log.json: {len(log)} execucao(oes) registrada(s)")
