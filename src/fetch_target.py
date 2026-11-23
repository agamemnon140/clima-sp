"""Baixa a série diária (Open-Meteo Archive) de cada local e agrega em mensal.

Por padrão a atualização é incremental: o CSV mensal já commitado cobre de 1940 até o mês
da última execução, e só a cauda é rebaixada. Isso não é otimização, é o que faz o pipeline
passar no CI — os runners do GitHub saem por IPs compartilhados que o Open-Meteo estrangula,
e a terceira requisição seguida trava até estourar o timeout. Rebaixando 86 anos em 5 chunks
todo mês, a run de 05/07, a de 05/08 e uma manual falharam as três no mesmo terceiro chunk.
Com uma requisição só, não se chega lá. `--full` refaz a série inteira quando preciso.

Um local novo (sem CSV) precisa da série inteira uma vez. Esse download é retomável: cada
bloco baixado é gravado na hora, e a execução seguinte continua do último mês gravado. Se o
Open-Meteo cortar no meio, o que já veio não se perde e o local só entra no modelo quando a
série estiver completa.
"""
import sys
import time
from datetime import date, timedelta

import pandas as pd
import requests

from . import config

# O Open-Meteo pesa cada requisição pelo número de dias pedidos, e o plano gratuito tem
# teto por minuto (600 chamadas ponderadas). Um bloco de dez anos já fica perto disso, então
# downloads longos vão em blocos de dez anos com mais de um minuto entre eles.
CHUNK_YEARS = 10
PAUSA_ENTRE_CHUNKS = 65.0
TIMEOUT = 60
TENTATIVAS = 4
ESPERA_BASE = 30

# O ERA5T das últimas semanas é preliminar e sai substituído pelo ERA5 definitivo com ~2-3
# meses de defasagem. O incremental refaz essa janela em vez de confiar no que ficou no CSV,
# senão os meses recentes congelam com o valor provisório para sempre.
MESES_DE_SOBREPOSICAO = 6

ARQUIVO = "alvo_mensal.csv"


def _last_day_of_previous_month(today: date) -> date:
    return today.replace(day=1) - timedelta(days=1)


def _mes_anterior(primeiro_do_mes: date) -> date:
    return (primeiro_do_mes - timedelta(days=1)).replace(day=1)


def fetch_chunk(local: config.Local, start: str, end: str) -> pd.DataFrame:
    params = {
        "latitude": local.latitude,
        "longitude": local.longitude,
        "start_date": start,
        "end_date": end,
        "daily": "temperature_2m_mean,precipitation_sum",
        "timezone": local.timezone,
    }
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            resp = requests.get(config.OPEN_METEO_URL, params=params, timeout=TIMEOUT)
            resp.raise_for_status()
            break
        except requests.RequestException as erro:
            # 4xx que não seja 429 é parâmetro errado: repetir só gasta tempo.
            status = getattr(erro.response, "status_code", None)
            if status is not None and status < 500 and status != 429:
                raise
            if tentativa == TENTATIVAS:
                raise
            espera = ESPERA_BASE * 2 ** (tentativa - 1)
            print(f"  {start}: {type(erro).__name__}"
                  f"{f' {status}' if status else ''}, tentativa {tentativa}/{TENTATIVAS}, "
                  f"repetindo em {espera}s")
            time.sleep(espera)
    daily = resp.json()["daily"]
    return pd.DataFrame({
        "date": pd.to_datetime(daily["time"]),
        "temp": daily["temperature_2m_mean"],
        "precip": daily["precipitation_sum"],
    })


def _blocos(inicio: date, fim: date) -> list[tuple[date, date]]:
    """Divide o intervalo em blocos de até CHUNK_YEARS anos, cortados em viradas de ano."""
    blocos = []
    for y0 in range(inicio.year, fim.year + 1, CHUNK_YEARS):
        y1 = min(y0 + CHUNK_YEARS - 1, fim.year)
        blocos.append((inicio if y0 == inicio.year else date(y0, 1, 1),
                       fim if y1 >= fim.year else date(y1, 12, 31)))
    return blocos


def _agregar_mensal(daily: pd.DataFrame) -> pd.DataFrame:
    daily = daily.dropna().copy()
    daily["year"] = daily["date"].dt.year
    daily["month"] = daily["date"].dt.month
    monthly = daily.groupby(["year", "month"]).agg(
        precip=("precip", "sum"),
        temp=("temp", "mean"),
        n_days=("date", "count"),
    ).reset_index()
    # descarta meses incompletos (falhas na reanálise ou mês corrente parcial)
    return monthly[monthly["n_days"] >= 28 - 3].drop(columns="n_days")


def _mesclar(existente: pd.DataFrame | None, novo: pd.DataFrame) -> pd.DataFrame:
    junto = novo if existente is None else pd.concat([existente, novo], ignore_index=True)
    junto = junto.drop_duplicates(subset=["year", "month"], keep="last")
    return junto.sort_values(["year", "month"]).reset_index(drop=True)


def _inicio_incremental(existente: pd.DataFrame) -> date:
    ultimo = existente.sort_values(["year", "month"]).iloc[-1]
    ancora = date(int(ultimo["year"]), int(ultimo["month"]), 1)
    for _ in range(MESES_DE_SOBREPOSICAO):
        ancora = _mes_anterior(ancora)
    return ancora


def _gravar(caminho, monthly: pd.DataFrame) -> None:
    # Sem arredondar, reescrever o CSV mexe no 16º dígito de linhas que nem foram rebaixadas
    # (o round-trip texto→float64→texto não é estável) e o commit mensal vira 250 linhas de
    # ruído. As casas aqui estão acima da precisão real da fonte: o diário vem com 0,1 mm e
    # ~0,01 °C, então o resto era acúmulo de soma, nunca sinal.
    monthly.round({"precip": 1, "temp": 4}).to_csv(caminho, index=False)


def fetch_target(local: config.Local = config.PADRAO, full: bool = False) -> None:
    """Atualiza o CSV mensal do local. Se um bloco falhar, os anteriores já estão gravados."""
    local.raw_dir.mkdir(parents=True, exist_ok=True)
    caminho = local.raw_dir / ARQUIVO
    end_date = _last_day_of_previous_month(date.today())

    existente = pd.read_csv(caminho) if caminho.exists() else None
    if existente is not None and existente.empty:
        existente = None

    if full or existente is None:
        motivo = "--full" if full else f"{ARQUIVO} ausente"
        print(f"{local.nome}: rebuild completo ({motivo}): {config.TARGET_START_YEAR} a {end_date}")
        inicio = date(config.TARGET_START_YEAR, 1, 1)
    else:
        inicio = _inicio_incremental(existente)
        if inicio > end_date:
            print(f"{local.nome}: alvo mensal ja cobre ate {end_date}: nada a baixar")
            return
        print(f"{local.nome}: incremental: {inicio} a {end_date} "
              f"({MESES_DE_SOBREPOSICAO} meses de sobreposicao, ERA5T e preliminar)")

    monthly = existente
    for i, (bloco_inicio, bloco_fim) in enumerate(_blocos(inicio, end_date)):
        if i:
            time.sleep(PAUSA_ENTRE_CHUNKS)
        novo = _agregar_mensal(fetch_chunk(local, bloco_inicio.isoformat(), bloco_fim.isoformat()))
        monthly = _mesclar(monthly, novo)
        _gravar(caminho, monthly)  # progresso gravado a cada bloco: um corte não perde o que veio
        print(f"baixado {bloco_inicio} a {bloco_fim}")

    monthly = pd.read_csv(caminho)
    annual = monthly.groupby("year").agg(precip=("precip", "sum"), temp=("temp", "mean"))
    full_years = annual[annual.index < end_date.year]
    print(f"{local.nome}: alvo mensal: {len(monthly)} meses ate {end_date.isoformat()}")
    print(f"sanidade (medias anuais): precip {full_years.precip.mean():.0f} mm/ano, "
          f"temp {full_years.temp.mean():.1f} C")


def serie_completa(local: config.Local, hoje: date | None = None) -> bool:
    """A série do local vai de 1940 até o último mês fechado?

    O ERA5 tem ~5 dias de defasagem, então nos primeiros dias do mês o mês anterior ainda
    pode estar incompleto e ficar de fora: tolera-se um mês de atraso.
    """
    caminho = local.raw_dir / ARQUIVO
    if not caminho.exists():
        return False
    monthly = pd.read_csv(caminho)
    if monthly.empty:
        return False
    t = monthly["year"] * 12 + monthly["month"]
    fim = _last_day_of_previous_month(hoje or date.today())
    return bool(t.min() <= config.TARGET_START_YEAR * 12 + 1 and t.max() >= fim.year * 12 + fim.month - 1)


if __name__ == "__main__":
    args = sys.argv[1:]
    slugs = [a for a in args if not a.startswith("--")]
    for alvo in ([config.local_por_slug(s) for s in slugs] or config.LOCAIS):
        fetch_target(alvo, full="--full" in args)
