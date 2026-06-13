"""Previsão operacional: treina com todo o histórico e prevê a partir dos índices atuais.

Índices defasados (ex.: DMI) entram por persistência — usa-se a média dos 3 últimos
valores disponíveis e a defasagem é registrada para constar em meta.json.
"""
from datetime import date

import numpy as np
import pandas as pd

from . import build_dataset, config, model


def latest_predictors(t_init: int) -> tuple[dict, dict]:
    """Média dos 3 últimos valores disponíveis de cada índice + defasagem em meses."""
    feats, lags = {}, {}
    for name in config.INDICES:
        df = build_dataset.load_monthly(name)
        df["t"] = df["year"] * 12 + df["month"]
        df = df.sort_values("t")
        feats[name] = df["value"].tail(3).mean()
        lags[name] = int(t_init - df["t"].iloc[-1])
    return feats, lags


def season_climatology() -> pd.DataFrame:
    """Média 1991-2020 de cada estação, para dar contexto físico às anomalias."""
    seasons = build_dataset.seasonal_target()
    clim_mask = seasons["season_year"].between(config.CLIMATOLOGY_START, config.CLIMATOLOGY_END)
    return seasons[clim_mask].groupby("season_month")[config.VARIABLES].mean()


def run() -> dict:
    today = date.today()
    t_init = today.year * 12 + today.month
    feats, lags = latest_predictors(t_init)
    feats["trend"] = today.year + (today.month - 0.5) / 12

    # persistência: anomalia da última estação totalmente observada (por variável)
    seasons = build_dataset.seasonal_target()
    seasons = seasons.set_index(seasons["season_year"] * 12 + seasons["season_month"])
    t_persist = t_init - 3
    persist = {var: float(seasons.loc[t_persist, f"anom_{var}"])
               for var in config.VARIABLES} if t_persist in seasons.index else \
              {var: 0.0 for var in config.VARIABLES}

    def x_new(var):
        return pd.DataFrame([{**feats, "persist": persist[var]}])[config.FEATURES]

    dataset = pd.read_csv(config.PROCESSED_DIR / "dataset.csv")
    clim = season_climatology()

    previsoes = []
    for lead in config.LEADS:
        t_start = t_init + lead
        season_year, season_month = divmod(t_start - 1, 12)
        season_month += 1
        variaveis = {}
        for var in config.VARIABLES:
            grp = dataset[(dataset["var"] == var) & (dataset["lead"] == lead)
                          & (dataset["season_month"] == season_month)]
            thr = model.tercile_thresholds(grp["anomaly"])
            y_cat = model.categorize(grp["anomaly"], thr)
            clf = model.fit_tercile_model(grp[config.FEATURES], y_cat)
            probs = model.predict_probs(clf, x_new(var))[0]
            reg = model.fit_anomaly_model(grp[config.FEATURES], grp["anomaly"])
            anom = float(reg.predict(x_new(var))[0])
            clim_val = float(clim.loc[season_month, var])
            variaveis[var] = {
                "p_abaixo": round(float(probs[0]), 3),
                "p_normal": round(float(probs[1]), 3),
                "p_acima": round(float(probs[2]), 3),
                "anomalia": round(anom, 2),
                "climatologia": round(clim_val, 1),
                "limiar_abaixo": round(float(thr[0]), 2),
                "limiar_acima": round(float(thr[1]), 2),
            }
        previsoes.append({
            "lead": lead,
            "estacao": config.SEASON_NAMES[season_month - 1],
            "ano": season_year,
            "inicio": f"{season_year}-{season_month:02d}",
            "variaveis": variaveis,
        })
    return {
        "inicializacao": f"{today.year}-{today.month:02d}",
        "indices_usados": {k: round(v, 2) for k, v in feats.items()},
        "defasagens_meses": lags,
        "previsoes": previsoes,
    }


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=2, ensure_ascii=False))
