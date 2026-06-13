"""Validação cruzada leave-one-year-out: mede a habilidade real do modelo por lead.

Anti-vazamento: tercis, padronização e coeficientes são recalculados dentro de
cada fold, usando apenas os anos de treino.
"""
import numpy as np
import pandas as pd

from . import config, model


def rps(probs: np.ndarray, obs_cat: np.ndarray) -> np.ndarray:
    """Ranked Probability Score por previsão (menor = melhor)."""
    cum_p = np.cumsum(probs, axis=1)
    obs_onehot = np.eye(3)[obs_cat]
    cum_o = np.cumsum(obs_onehot, axis=1)
    return ((cum_p - cum_o) ** 2).sum(axis=1)


def run_hindcast(dataset: pd.DataFrame) -> pd.DataFrame:
    """Para cada (var, lead, estação): LOYO sobre os anos da estação-alvo."""
    records = []
    groups = dataset.groupby(["var", "lead", "season_month"])
    for (var, lead, season_month), grp in groups:
        grp = grp.reset_index(drop=True)
        years = grp["season_year"].unique()
        for year in years:
            train = grp[grp["season_year"] != year]
            test = grp[grp["season_year"] == year]
            thr = model.tercile_thresholds(train["anomaly"])
            y_train = model.categorize(train["anomaly"], thr)
            clf = model.fit_tercile_model(train[config.FEATURES], y_train)
            probs = model.predict_probs(clf, test[config.FEATURES])
            obs_cat = model.categorize(test["anomaly"], thr)
            for i, (_, row) in enumerate(test.iterrows()):
                records.append({
                    "var": var, "lead": lead,
                    "season_year": row["season_year"], "season": row["season"],
                    "p_abaixo": probs[i, 0], "p_normal": probs[i, 1],
                    "p_acima": probs[i, 2], "obs_cat": obs_cat[i],
                })
    return pd.DataFrame(records)


def skill_table(hindcast: pd.DataFrame) -> pd.DataFrame:
    """RPSS e hit rate vs. climatologia (1/3, 1/3, 1/3), por var e lead."""
    rows = []
    for (var, lead), grp in hindcast.groupby(["var", "lead"]):
        probs = grp[["p_abaixo", "p_normal", "p_acima"]].to_numpy()
        obs = grp["obs_cat"].to_numpy().astype(int)
        rps_model = rps(probs, obs).mean()
        rps_clim = rps(np.full_like(probs, 1 / 3), obs).mean()
        rpss = 1 - rps_model / rps_clim
        hit_rate = (probs.argmax(axis=1) == obs).mean()
        rows.append({"var": var, "lead": lead, "rpss": round(rpss, 4),
                     "hit_rate": round(hit_rate, 4), "n": len(grp)})
    return pd.DataFrame(rows).sort_values(["var", "lead"]).reset_index(drop=True)


def run() -> pd.DataFrame:
    dataset = pd.read_csv(config.PROCESSED_DIR / "dataset.csv")
    hindcast = run_hindcast(dataset)
    # float_format fixo evita diffs espúrios entre plataformas no commit mensal
    hindcast.to_csv(config.PROCESSED_DIR / "hindcast.csv", index=False, float_format="%.4f")
    skill = skill_table(hindcast)
    skill.to_csv(config.PROCESSED_DIR / "skill.csv", index=False)
    print(skill.to_string(index=False))
    return skill


if __name__ == "__main__":
    run()
