"""Modelos estatísticos: logística multinomial (tercis) e Ridge (anomalia pontual)."""
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config

CATEGORIES = ["abaixo", "normal", "acima"]

# Hiperparâmetros fixados a priori para n~45 por estação: regularização forte e
# encolhimento das probabilidades em direção à climatologia (anti-superconfiança).
C_LOGISTIC = 0.1
SHRINK = 0.6


def tercile_thresholds(anomalies: pd.Series) -> np.ndarray:
    return np.quantile(anomalies, [1 / 3, 2 / 3])


def categorize(anomalies: pd.Series, thresholds: np.ndarray) -> np.ndarray:
    return np.digitize(anomalies, thresholds)  # 0=abaixo, 1=normal, 2=acima


def fit_tercile_model(X: pd.DataFrame, y_cat: np.ndarray):
    """Retorna None se faltar alguma classe no treino (cai para climatologia)."""
    if len(np.unique(y_cat)) < 3:
        return None
    pipe = make_pipeline(StandardScaler(),
                         LogisticRegression(C=C_LOGISTIC, max_iter=2000))
    return pipe.fit(X, y_cat)


def predict_probs(model, X: pd.DataFrame) -> np.ndarray:
    if model is None:
        return np.full((len(X), 3), 1 / 3)
    probs = np.zeros((len(X), 3))
    classes = model[-1].classes_.astype(int)
    probs[:, classes] = model.predict_proba(X)
    return SHRINK * probs + (1 - SHRINK) / 3


def fit_anomaly_model(X: pd.DataFrame, y: pd.Series):
    pipe = make_pipeline(StandardScaler(), Ridge(alpha=1.0))
    return pipe.fit(X, y)
