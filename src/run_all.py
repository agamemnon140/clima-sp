"""Pipeline completo: dados → dataset → hindcast → previsão → JSONs do dashboard."""
from . import build_dataset, export_json, fetch_indices, fetch_target, hindcast


def main() -> None:
    print("== 1/4 baixando indices ==")
    fetch_indices.fetch_all()
    print("== 2/4 baixando alvo ERA5 ==")
    fetch_target.fetch_target()
    print("== 3/4 montando dataset e validando (hindcast LOYO) ==")
    build_dataset.build()
    hindcast.run()
    print("== 4/4 previsao operacional e JSONs ==")
    export_json.export_all()
    print("pipeline concluido")


if __name__ == "__main__":
    main()
