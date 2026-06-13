"""Monta o dataset preditor→alvo: anomalias sazonais e índices defasados por lead."""
import numpy as np
import pandas as pd

from . import config


def load_monthly(name: str) -> pd.DataFrame:
    return pd.read_csv(config.RAW_DIR / f"{name}.csv")


def seasonal_target() -> pd.DataFrame:
    """Agrega o alvo mensal em trimestres móveis (JFM...DJF) e calcula anomalias.

    Cada estação é identificada pelo (ano, mês) do seu primeiro mês.
    Anomalia relativa à climatologia 1991-2020 da mesma estação do ano.
    """
    monthly = load_monthly("alvo_mensal").set_index(["year", "month"]).sort_index()
    rows = []
    for (year, month) in monthly.index:
        months = [(year + (month + k - 1) // 12, (month + k - 1) % 12 + 1) for k in range(3)]
        if not all(m in monthly.index for m in months):
            continue
        chunk = monthly.loc[months]
        rows.append({
            "season_year": year,
            "season_month": month,
            "season": config.SEASON_NAMES[month - 1],
            "precipitacao": chunk["precip"].sum(),
            "temperatura": chunk["temp"].mean(),
        })
    seasons = pd.DataFrame(rows)

    clim_mask = seasons["season_year"].between(config.CLIMATOLOGY_START, config.CLIMATOLOGY_END)
    for var in config.VARIABLES:
        clim = seasons[clim_mask].groupby("season_month")[var].mean()
        seasons[f"anom_{var}"] = seasons[var] - seasons["season_month"].map(clim)
    return seasons


def predictor_table() -> pd.DataFrame:
    """Para cada mês de inicialização t: média dos 3 meses (t-2..t) de cada índice."""
    out = None
    for name in config.INDICES:
        df = load_monthly(name)
        df["t"] = df["year"] * 12 + df["month"]
        df = df.set_index("t")["value"].sort_index()
        smooth = df.rolling(3).mean().rename(name)
        out = smooth.to_frame() if out is None else out.join(smooth, how="outer")
    return out  # index t = year*12 + month


def build() -> None:
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    seasons = seasonal_target()
    seasons["t_start"] = seasons["season_year"] * 12 + seasons["season_month"]
    seasons = seasons.set_index("t_start")
    predictors = predictor_table()

    rows = []
    for lead in config.LEADS:
        for t_start, season in seasons.iterrows():
            t_init = t_start - lead
            init_year, init_month = divmod(t_init - 1, 12)
            init_month += 1
            if init_year < config.TRAIN_START_YEAR:
                continue
            if t_init not in predictors.index:
                continue
            feats = predictors.loc[t_init]
            if feats.isna().any():
                continue
            # persistência: última estação de 3 meses totalmente observada na
            # inicialização (a que começa em t_init-3 → meses t_init-3..t_init-1)
            t_persist = t_init - 3
            if t_persist not in seasons.index:
                continue
            for var in config.VARIABLES:
                persist = seasons.loc[t_persist, f"anom_{var}"]
                if pd.isna(persist):
                    continue
                rows.append({
                    "var": var,
                    "lead": lead,
                    "init_year": init_year,
                    "init_month": init_month,
                    "season_year": season["season_year"],
                    "season_month": int(season["season_month"]),
                    "season": season["season"],
                    **feats.to_dict(),
                    "trend": init_year + (init_month - 0.5) / 12,
                    "persist": float(persist),
                    "anomaly": season[f"anom_{var}"],
                })
    dataset = pd.DataFrame(rows)
    dataset.to_csv(config.PROCESSED_DIR / "dataset.csv", index=False)

    # sanidade: ONI deve correlacionar positivamente com chuva de verão no Sudeste em lead curto
    djf = dataset[(dataset["var"] == "precipitacao") & (dataset["lead"] == 3)
                  & (dataset["season"].isin(["DJF", "NDJ", "OND"]))]
    corr = djf["oni"].corr(djf["anomaly"])
    print(f"dataset: {len(dataset)} linhas, {dataset.season_year.min()}-{dataset.season_year.max()}")
    print(f"sanidade: corr(ONI, anomalia de chuva OND/NDJ/DJF, lead 3) = {corr:+.2f}")


if __name__ == "__main__":
    build()
