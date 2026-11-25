#!/usr/bin/env python3
"""Junta vários arquivos .mind (MindAR) de um alvo cada em um único arquivo multi-alvo.

Cada .mind guarda uma lista de alvos (`dataList`). Juntar é só concatenar essas listas,
sem recompilar nada — por isso os QR codes já impressos continuam sendo reconhecidos.

O índice de cada alvo no arquivo final (targetIndex) segue a ordem dos arquivos de entrada.
Por padrão usa assets/targets/*.mind em ordem alfabética (por isso os nomes começam com 0-, 1-, ...).

Uso:
    pip install msgpack
    python tools/merge_mind.py                                   # assets/targets/*.mind -> assets/targets.mind
    python tools/merge_mind.py -o saida.mind a.mind b.mind ...   # arquivos e ordem explícitos
"""
import argparse
import glob
import os
import sys

try:
    import msgpack
except ImportError:
    sys.exit("Instale a dependência primeiro:  pip install msgpack")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", help="arquivos .mind de entrada (na ordem dos índices)")
    ap.add_argument("-o", "--output", default=os.path.join(ROOT, "assets", "targets.mind"))
    args = ap.parse_args()

    inputs = args.inputs or sorted(glob.glob(os.path.join(ROOT, "assets", "targets", "*.mind")))
    if not inputs:
        sys.exit("Nenhum arquivo .mind encontrado.")

    version, data_list = None, []
    for path in inputs:
        with open(path, "rb") as f:
            content = msgpack.unpackb(f.read(), raw=False, strict_map_key=False)
        if version is None:
            version = content["v"]
        elif content["v"] != version:
            sys.exit(f"{path}: versão {content['v']} diferente de {version}; recompile os alvos com a mesma versão do MindAR.")
        for target in content["dataList"]:
            size = target["targetImage"]
            print(f"  targetIndex {len(data_list)}: {os.path.relpath(path, ROOT)}  ({size['width']}x{size['height']})")
            data_list.append(target)

    with open(args.output, "wb") as f:
        f.write(msgpack.packb({"v": version, "dataList": data_list}, use_bin_type=True))
    print(f"{len(data_list)} alvos -> {os.path.relpath(args.output, ROOT)}")


if __name__ == "__main__":
    main()
