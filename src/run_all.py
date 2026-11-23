"""Pipeline completo: dados → dataset → hindcast → previsão → JSONs do dashboard.

Os índices climáticos são baixados uma vez; depois cada local roda de ponta a ponta. A falha
de um local não derruba os outros: o erro é registrado, os demais seguem e o processo termina
com código 1 para a execução aparecer como falha. O que já foi baixado fica gravado, então a
execução seguinte continua de onde parou.
"""
import sys
import traceback

from . import build_dataset, config, export_json, fetch_indices, fetch_target, hindcast


def rodar_local(local: config.Local) -> None:
    print(f"-- {local.nome}: baixando alvo --")
    fetch_target.fetch_target(local)
    if not fetch_target.serie_completa(local):
        raise RuntimeError(f"serie de {local.nome} ainda incompleta; o modelo fica para a proxima execucao")
    print(f"-- {local.nome}: montando dataset e validando (hindcast LOYO) --")
    build_dataset.build(local)
    hindcast.run(local)
    print(f"-- {local.nome}: previsao operacional e JSONs --")
    export_json.export_local(local)


def main() -> int:
    print("== 1/2 baixando indices ==")
    fetch_indices.fetch_all()
    export_json.export_indices()
    print("== 2/2 alvo, validacao e previsao de cada local ==")
    falhas = []
    for local in config.LOCAIS:
        try:
            rodar_local(local)
        except Exception:
            traceback.print_exc()
            # Anotação que o GitHub Actions destaca no resumo da execução.
            print(f"::error::{local.nome}: pipeline nao concluiu (veja o log)")
            falhas.append(local.nome)
    if falhas:
        print(f"pipeline terminou com falha em: {', '.join(falhas)}")
        return 1
    print("pipeline concluido")
    return 0


if __name__ == "__main__":
    sys.exit(main())
