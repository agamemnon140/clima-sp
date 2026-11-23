"""Download retomável da série-alvo, sem rede: `python -m unittest tests.test_fetch_target`"""
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

import pandas as pd
import requests

from src import config, fetch_target

HOJE = date(2026, 11, 22)
VALINHOS = config.local_por_slug("valinhos")


class DataFixa(date):
    @classmethod
    def today(cls):
        return HOJE


class Resposta:
    def __init__(self, params):
        dias = pd.date_range(params["start_date"], params["end_date"])
        self._daily = {"time": [d.strftime("%Y-%m-%d") for d in dias],
                       "temperature_2m_mean": [20.0] * len(dias),
                       "precipitation_sum": [1.0] * len(dias)}

    def raise_for_status(self):
        pass

    def json(self):
        return {"daily": self._daily}


class FetchTargetTest(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.addCleanup(self.pasta.cleanup)
        self.pedidos = []
        self.falhar_a_partir_de = None  # ano inicial do bloco que deve falhar
        for alvo, valor in ((config, {"RAW_DIR": Path(self.pasta.name)}),
                            (fetch_target, {"date": DataFixa})):
            for nome, novo in valor.items():
                patch = mock.patch.object(alvo, nome, novo)
                patch.start()
                self.addCleanup(patch.stop)
        for nome, novo in (("sleep", lambda _s: None),):
            patch = mock.patch.object(fetch_target.time, nome, novo)
            patch.start()
            self.addCleanup(patch.stop)
        patch = mock.patch.object(fetch_target.requests, "get", self._get)
        patch.start()
        self.addCleanup(patch.stop)

    def _get(self, _url, params, timeout):
        self.pedidos.append((params["latitude"], params["start_date"], params["end_date"]))
        if self.falhar_a_partir_de and params["start_date"] >= f"{self.falhar_a_partir_de}-01-01":
            raise requests.ConnectionError("cortado")
        return Resposta(params)

    def _serie(self, local=VALINHOS):
        return pd.read_csv(local.raw_dir / fetch_target.ARQUIVO)

    def test_local_novo_baixa_tudo_em_blocos_de_dez_anos_na_propria_pasta(self):
        fetch_target.fetch_target(VALINHOS)
        self.assertEqual(len(self.pedidos), 9)
        self.assertEqual(self.pedidos[0], (-22.97, "1940-01-01", "1949-12-31"))
        self.assertEqual(self.pedidos[-1], (-22.97, "2020-01-01", "2026-10-31"))
        serie = self._serie()
        self.assertEqual(len(serie), (2026 - 1940) * 12 + 10)
        self.assertEqual(tuple(serie.iloc[-1][["year", "month"]].astype(int)), (2026, 10))
        self.assertTrue((VALINHOS.raw_dir / fetch_target.ARQUIVO).parent.name == "valinhos")
        self.assertTrue(fetch_target.serie_completa(VALINHOS, HOJE))

    def test_corte_no_meio_preserva_os_blocos_baixados_e_a_execucao_seguinte_retoma(self):
        self.falhar_a_partir_de = 1960
        with self.assertRaises(requests.ConnectionError):
            fetch_target.fetch_target(VALINHOS)
        serie = self._serie()
        self.assertEqual(tuple(serie.iloc[-1][["year", "month"]].astype(int)), (1959, 12))
        self.assertFalse(fetch_target.serie_completa(VALINHOS, HOJE))
        # 2 blocos bons + 4 tentativas do bloco que falhou
        self.assertEqual(len(self.pedidos), 2 + fetch_target.TENTATIVAS)

        self.falhar_a_partir_de = None
        self.pedidos.clear()
        fetch_target.fetch_target(VALINHOS)
        # retoma seis meses antes do último mês gravado, sem repetir 1940-1958
        self.assertEqual(self.pedidos[0][1], "1959-06-01")
        self.assertEqual(len(self.pedidos), 7)
        serie = self._serie()
        self.assertEqual(len(serie), (2026 - 1940) * 12 + 10)
        self.assertFalse(serie.duplicated(["year", "month"]).any())
        self.assertTrue(fetch_target.serie_completa(VALINHOS, HOJE))

    def test_serie_em_dia_faz_uma_unica_requisicao_incremental(self):
        fetch_target.fetch_target(VALINHOS)
        self.pedidos.clear()
        fetch_target.fetch_target(VALINHOS)
        self.assertEqual(self.pedidos, [(-22.97, "2026-04-01", "2026-10-31")])

    def test_cada_local_usa_as_proprias_coordenadas_e_o_padrao_fica_na_raiz(self):
        fetch_target.fetch_target(config.PADRAO)
        self.assertEqual(self.pedidos[0][0], -23.5)
        self.assertEqual((config.PADRAO.raw_dir / fetch_target.ARQUIVO).parent, Path(self.pasta.name))
        self.assertFalse(fetch_target.serie_completa(VALINHOS, HOJE))

    def test_full_com_corte_nao_encurta_uma_serie_que_ja_estava_completa(self):
        fetch_target.fetch_target(VALINHOS)
        self.falhar_a_partir_de = 1950
        with self.assertRaises(requests.ConnectionError):
            fetch_target.fetch_target(VALINHOS, full=True)
        self.assertEqual(len(self._serie()), (2026 - 1940) * 12 + 10)
        self.assertTrue(fetch_target.serie_completa(VALINHOS, HOJE))

    def test_serie_completa_tolera_um_mes_de_atraso_e_exige_o_inicio_em_1940(self):
        fetch_target.fetch_target(VALINHOS)
        caminho = VALINHOS.raw_dir / fetch_target.ARQUIVO
        serie = self._serie()
        serie.iloc[:-1].to_csv(caminho, index=False)   # falta outubro: ainda vale
        self.assertTrue(fetch_target.serie_completa(VALINHOS, HOJE))
        serie.iloc[:-2].to_csv(caminho, index=False)   # falta setembro também
        self.assertFalse(fetch_target.serie_completa(VALINHOS, HOJE))
        serie.iloc[12:].to_csv(caminho, index=False)   # começa em 1941
        self.assertFalse(fetch_target.serie_completa(VALINHOS, HOJE))


if __name__ == "__main__":
    unittest.main()
