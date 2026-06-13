"""Configuração central do clima-sp."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
DOCS_DATA_DIR = BASE_DIR / "docs" / "data"

# Ponto representativo da RMSP (próximo ao Mirante de Santana)
LATITUDE = -23.5
LONGITUDE = -46.62
TIMEZONE = "America/Sao_Paulo"

CLIMATOLOGY_START = 1991
CLIMATOLOGY_END = 2020
TRAIN_START_YEAR = 1979  # limitado pelo início da série do AAO
TARGET_START_YEAR = 1940

# Horizontes de previsão, em meses entre a inicialização e o início da estação-alvo
LEADS = [3, 6, 12, 24]

INDICES = {
    "oni": {
        "url": "https://psl.noaa.gov/data/correlation/oni.data",
        "format": "psl",
        "nome": "ONI (ENSO, Niño 3.4)",
        "descricao": "Anomalia de temperatura da superfície do mar no Pacífico equatorial "
                     "central (região Niño 3.4), em °C. Acima de +0,5 por vários meses = "
                     "El Niño; abaixo de -0,5 = La Niña. É o principal motor da "
                     "previsibilidade sazonal: El Niño tende a verões mais quentes e "
                     "chuvosos no Sudeste; La Niña, mais secos.",
    },
    "tsa": {
        "url": "https://psl.noaa.gov/data/correlation/tsa.data",
        "format": "psl",
        "nome": "TSA (Atlântico Sul tropical)",
        "descricao": "Anomalia de temperatura do Atlântico tropical sul (equador a ~20°S), "
                     "em °C. Atlântico mais quente (positivo) fornece mais umidade para a "
                     "ZCAS — o corredor de chuva que atravessa o Sudeste no verão.",
    },
    "dmi": {
        "url": "https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data",
        "format": "psl",
        "nome": "DMI (Dipolo do Oceano Índico)",
        "descricao": "Diferença de temperatura entre o oeste e o leste do Oceano Índico "
                     "tropical, em °C. A fase positiva tende a reduzir a chuva de "
                     "primavera no centro-sul do Brasil por teleconexões atmosféricas.",
    },
    "aao": {
        "url": "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/aao/monthly.aao.index.b79.current.ascii",
        "format": "cpc",
        "nome": "AAO (Oscilação Antártica)",
        "descricao": "Mede a posição do cinturão de ventos de oeste do Hemisfério Sul "
                     "(adimensional). Fase negativa facilita a chegada de frentes frias "
                     "ao Sudeste (mais chuva/frio); fase positiva tende a bloqueá-las.",
    },
}

OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"

# SEASON_NAMES[m-1] = nome da estação (trimestre móvel) que começa no mês m
SEASON_NAMES = ["JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA",
                "JAS", "ASO", "SON", "OND", "NDJ", "DJF"]

VARIABLES = ["precipitacao", "temperatura"]
FEATURES = ["oni", "tsa", "dmi", "aao", "trend"]
