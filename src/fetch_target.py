"""Baixa a série diária ERA5 (Open-Meteo Archive) para o ponto da RMSP e agrega em mensal."""
from datetime import date, timedelta

import pandas as pd
import requests

from . import config

CHUNK_YEARS = 20


def _last_day_of_previous_month(today: date) -> date:
    return today.replace(day=1) - timedelta(days=1)


def fetch_chunk(start: str, end: str) -> pd.DataFrame:
    params = {
        "latitude": config.LATITUDE,
        "longitude": config.LONGITUDE,
        "start_date": start,
        "end_date": end,
        "daily": "temperature_2m_mean,precipitation_sum",
        "timezone": config.TIMEZONE,
    }
    resp = requests.get(config.OPEN_METEO_URL, params=params, timeout=120)
    resp.raise_for_status()
    daily = resp.json()["daily"]
    return pd.DataFrame({
        "date": pd.to_datetime(daily["time"]),
        "temp": daily["temperature_2m_mean"],
        "precip": daily["precipitation_sum"],
    })


def fetch_target() -> None:
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    end_date = _last_day_of_previous_month(date.today())
    frames = []
    for y0 in range(config.TARGET_START_YEAR, end_date.year + 1, CHUNK_YEARS):
        y1 = min(y0 + CHUNK_YEARS - 1, end_date.year)
        chunk_end = f"{y1}-12-31" if y1 < end_date.year else end_date.isoformat()
        frames.append(fetch_chunk(f"{y0}-01-01", chunk_end))
        print(f"baixado {y0}-{y1}")
    daily = pd.concat(frames, ignore_index=True).dropna()

    daily["year"] = daily["date"].dt.year
    daily["month"] = daily["date"].dt.month
    monthly = daily.groupby(["year", "month"]).agg(
        precip=("precip", "sum"),
        temp=("temp", "mean"),
        n_days=("date", "count"),
    ).reset_index()
    # descarta meses incompletos (falhas na reanálise ou mês corrente parcial)
    monthly = monthly[monthly["n_days"] >= 28 - 3].drop(columns="n_days")
    monthly.to_csv(config.RAW_DIR / "alvo_mensal.csv", index=False)

    annual = monthly.groupby("year").agg(precip=("precip", "sum"), temp=("temp", "mean"))
    full_years = annual[annual.index < end_date.year]
    print(f"alvo mensal: {len(monthly)} meses ate {end_date.isoformat()}")
    print(f"sanidade (medias anuais): precip {full_years.precip.mean():.0f} mm/ano, "
          f"temp {full_years.temp.mean():.1f} C")


if __name__ == "__main__":
    fetch_target()
