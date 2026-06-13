"""Previsão mês a mês para os próximos 24 meses, com incerteza (±1 desvio padrão).

Diferente do bloco sazonal (tercis), aqui o alvo é o valor mensal absoluto:
esperado = climatologia do mês + anomalia prevista por Ridge. O sigma de cada
horizonte vem dos resíduos de validação leave-one-year-out — por isso a faixa
alarga até a variabilidade climatológica plena nos horizontes longos, que é o
limite físico real da previsibilidade.
"""
from datetime import date

import numpy as np
import pandas as pd

from . import build_dataset, config, forecast, model

MONTHLY_LEADS = range(0, 25)  # lead 0 = mês corrente (ainda sem observação fechada)


def monthly_anomalies() -> tuple[pd.DataFrame, pd.DataFrame]:
    m = build_dataset.load_monthly("alvo_mensal").rename(
        columns={"precip": "precipitacao", "temp": "temperatura"})
    clim_mask = m["year"].between(config.CLIMATOLOGY_START, config.CLIMATOLOGY_END)
    clim = m[clim_mask].groupby("month")[config.VARIABLES].mean()
    for var in config.VARIABLES:
        m[f"anom_{var}"] = m[var] - m["month"].map(clim[var])
    m["t"] = m["year"] * 12 + m["month"]
    return m.sort_values("t"), clim


def run() -> dict:
    monthly, clim = monthly_anomalies()
    predictors = build_dataset.predictor_table()

    today = date.today()
    t_init = today.year * 12 + today.month
    feats, _ = forecast.latest_predictors(t_init)
    feats["trend"] = today.year + (today.month - 0.5) / 12

    # persistência mensal: anomalia observada de cada variável por mês (t = ano*12+mês)
    anom_by_t = {var: monthly.set_index("t")[f"anom_{var}"] for var in config.VARIABLES}
    indices_cols = list(predictors.columns)  # oni/tsa/dmi/aao

    previsao = []
    for lead in MONTHLY_LEADS:
        t_target = t_init + lead
        target_year, target_month = divmod(t_target - 1, 12)
        target_month += 1

        # amostra de treino: mesmo mês do calendário, mesmo lead, 1979+
        grp = monthly[monthly["month"] == target_month].copy()
        grp["t_init"] = grp["t"] - lead
        grp["init_year"] = (grp["t_init"] - 1) // 12
        grp = grp[grp["init_year"] >= config.TRAIN_START_YEAR]
        grp = grp.join(predictors, on="t_init").dropna(subset=indices_cols)
        grp["trend"] = grp["init_year"] + (((grp["t_init"] - 1) % 12 + 1) - 0.5) / 12

        entry = {"mes": f"{target_year}-{target_month:02d}", "lead": lead}
        for var in config.VARIABLES:
            # persistência = anomalia da variável no mês anterior à inicialização
            g = grp.copy()
            g["persist"] = (g["t_init"] - 1).map(anom_by_t[var])
            g = g.dropna(subset=["persist"])
            x_new = pd.DataFrame([{**feats,
                                   "persist": float(anom_by_t[var].get(t_init - 1, 0.0))}])[config.FEATURES]
            y = g[f"anom_{var}"]
            residuos = []
            for yr in g["year"].unique():
                tr = g[g["year"] != yr]
                te = g[g["year"] == yr]
                reg = model.fit_anomaly_model(tr[config.FEATURES], tr[f"anom_{var}"])
                residuos.extend(te[f"anom_{var}"].to_numpy()
                                - reg.predict(te[config.FEATURES]))
            sigma = float(np.std(residuos))
            reg = model.fit_anomaly_model(g[config.FEATURES], y)
            anom = float(reg.predict(x_new)[0])
            clim_val = float(clim.loc[target_month, var])
            esperado = clim_val + anom
            if var == "precipitacao":
                esperado = max(esperado, 0.0)
            nd = 1 if var == "precipitacao" else 2
            entry[var] = {
                "esperado": round(esperado, nd),
                "sigma": round(sigma, nd),
                "climatologia": round(clim_val, nd),
            }
        previsao.append(entry)

    # série completa: o dashboard decide quantos anos exibir
    hist = monthly
    historico = {
        "meses": [f"{int(r.year)}-{int(r.month):02d}" for r in hist.itertuples()],
        "precipitacao": [round(v, 1) for v in hist["precipitacao"]],
        "temperatura": [round(v, 2) for v in hist["temperatura"]],
        "climatologia": {
            "precipitacao": [round(float(clim.loc[int(r.month), "precipitacao"]), 1)
                             for r in hist.itertuples()],
            "temperatura": [round(float(clim.loc[int(r.month), "temperatura"]), 2)
                            for r in hist.itertuples()],
        },
    }
    return {"historico": historico, "previsao": previsao}


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=2, ensure_ascii=False)[:2000])
