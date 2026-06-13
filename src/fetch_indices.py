"""Baixa os índices climáticos mensais (ONI, TSA, DMI, AAO) e salva em data/raw/."""
import requests
import pandas as pd

from . import config

# Índices reais ficam em [-5, 5]; códigos de missing são -99.9, -99.99, -9999 etc.
MISSING_THRESHOLD = -9.0


def parse_psl(text: str) -> pd.DataFrame:
    """Formato PSL: 1ª linha 'ano_inicial ano_final', depois linhas 'ano v1 ... v12'."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    y0, y1 = (int(t) for t in lines[0].split()[:2])
    rows = []
    for line in lines[1:]:
        toks = line.split()
        try:
            year = int(toks[0])
        except ValueError:
            continue
        if not (y0 <= year <= y1) or len(toks) < 13:
            continue
        for month, tok in enumerate(toks[1:13], start=1):
            val = float(tok)
            if val > MISSING_THRESHOLD:
                rows.append((year, month, val))
    return pd.DataFrame(rows, columns=["year", "month", "value"])


def parse_cpc(text: str) -> pd.DataFrame:
    """Formato CPC: uma linha 'ano mes valor' por registro."""
    rows = []
    for line in text.splitlines():
        toks = line.split()
        if len(toks) != 3:
            continue
        try:
            year, month, val = int(toks[0]), int(toks[1]), float(toks[2])
        except ValueError:
            continue
        if 1 <= month <= 12 and val > MISSING_THRESHOLD:
            rows.append((year, month, val))
    return pd.DataFrame(rows, columns=["year", "month", "value"])


def fetch_all() -> None:
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name, spec in config.INDICES.items():
        resp = requests.get(spec["url"], timeout=60)
        resp.raise_for_status()
        parser = parse_psl if spec["format"] == "psl" else parse_cpc
        df = parser(resp.text)
        if df.empty:
            raise RuntimeError(f"Indice {name}: nenhum dado parseado de {spec['url']}")
        df = df.sort_values(["year", "month"]).reset_index(drop=True)
        df.to_csv(config.RAW_DIR / f"{name}.csv", index=False)
        last = df.iloc[-1]
        print(f"{name}: {df.year.min()}-{int(last.year)}/{int(last.month):02d} "
              f"({len(df)} meses, ultimo valor {last.value:+.2f})")


if __name__ == "__main__":
    fetch_all()
