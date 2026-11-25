#!/usr/bin/env python3
"""Deixa os modelos 3D leves para celular.

Lê models/original/<nome>.glb e grava models/<nome>.glb:
  * aplica as transformações dos nós (o modelo final tem um único nó, sem hierarquia);
  * junta todas as malhas que usam o mesmo material (menos "draw calls" = mais FPS);
  * solda vértices duplicados e simplifica a malha (fast-simplification);
  * recalcula normais suaves e comprime com Draco (KHR_draco_mesh_compression);
  * modelos com textura: mantém a malha e reduz as texturas (JPEG, no máx. 1024 px).

Uso:
    pip install numpy pygltflib fast-simplification DracoPy pillow
    python tools/optimize_models.py                  # todos, com as proporções padrão abaixo
    python tools/optimize_models.py grafeno=0.3      # proporção de triângulos mantida (0–1)
"""
import io
import json
import os
import sys

import numpy as np

try:
    import DracoPy
    import fast_simplification
    import pygltflib
    from PIL import Image
except ImportError:
    sys.exit("Instale as dependências:  pip install numpy pygltflib fast-simplification DracoPy pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "models", "original")
DST = os.path.join(ROOT, "models")

# Fração de triângulos mantida em cada modelo (ajuste se algum ficar "facetado" demais).
DEFAULT_RATIOS = {
    "diamante": 0.35,
    "fulereno": 0.35,
    "grafeno": 0.45,
    "grafite": 0.5,
    "nanotubo": 0.15,
    "grafite-rocha": 1.0,
}

DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DRACO = "KHR_draco_mesh_compression"


# ---------------------------------------------------------------- leitura

def read_accessor(gltf, blob, idx):
    acc = gltf.accessors[idx]
    bv = gltf.bufferViews[acc.bufferView]
    dt = np.dtype(DTYPES[acc.componentType])
    n = NCOMP[acc.type]
    start = (bv.byteOffset or 0) + (acc.byteOffset or 0)
    stride = bv.byteStride or dt.itemsize * n
    raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (acc.count - 1) + dt.itemsize * n, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(acc.count, dt.itemsize * n), strides=(stride, 1))
    return rows.copy().view(dt).reshape(acc.count, n)


def node_matrix(node):
    if node.matrix:
        return np.array(node.matrix, dtype=np.float64).reshape(4, 4).T
    t = np.array(node.translation or [0, 0, 0], dtype=np.float64)
    x, y, z, w = node.rotation or [0, 0, 0, 1]
    s = np.array(node.scale or [1, 1, 1], dtype=np.float64)
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def primitive_geometry(gltf, blob, prim):
    ext = (prim.extensions or {}).get(DRACO)
    if ext:
        bv = gltf.bufferViews[ext["bufferView"]]
        mesh = DracoPy.decode(blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength])
        return np.asarray(mesh.points, np.float64).reshape(-1, 3), np.asarray(mesh.faces, np.int64).reshape(-1, 3)
    pos = read_accessor(gltf, blob, prim.attributes.POSITION).astype(np.float64)
    if prim.indices is not None:
        faces = read_accessor(gltf, blob, prim.indices).astype(np.int64).reshape(-1, 3)
    else:
        faces = np.arange(len(pos), dtype=np.int64).reshape(-1, 3)
    return pos, faces


def material_key(gltf, idx):
    if idx is None:
        return json.dumps({}), None
    m = gltf.materials[idx]
    d = json.loads(m.to_json())
    d.pop("name", None)
    return json.dumps(d, sort_keys=True), m


def collect(gltf, blob):
    """{chave do material: (material, [(posições no mundo, faces), ...])}"""
    groups = {}

    def visit(i, parent):
        node = gltf.nodes[i]
        world = parent @ node_matrix(node)
        if node.mesh is not None:
            for prim in gltf.meshes[node.mesh].primitives:
                if prim.mode not in (None, 4):
                    continue
                pos, faces = primitive_geometry(gltf, blob, prim)
                pos = (np.c_[pos, np.ones(len(pos))] @ world.T)[:, :3]
                if np.linalg.det(world[:3, :3]) < 0:
                    faces = faces[:, ::-1]
                key, mat = material_key(gltf, prim.material)
                groups.setdefault(key, (mat, []))[1].append((pos, faces))
        for c in node.children or []:
            visit(c, world)

    for root in gltf.scenes[gltf.scene or 0].nodes:
        visit(root, np.eye(4))
    return groups


# ---------------------------------------------------------------- geometria

def merge(parts):
    pos, faces, off = [], [], 0
    for p, f in parts:
        pos.append(p)
        faces.append(f + off)
        off += len(p)
    return np.vstack(pos), np.vstack(faces)


def weld(pos, faces):
    diag = np.linalg.norm(pos.max(0) - pos.min(0)) or 1.0
    q = np.round(pos / (diag * 1e-5)).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    faces = inv.reshape(-1)[faces]
    ok = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return pos[first], faces[ok]


def vertex_normals(pos, faces):
    fn = np.cross(pos[faces[:, 1]] - pos[faces[:, 0]], pos[faces[:, 2]] - pos[faces[:, 0]])
    n = np.zeros_like(pos)
    for k in range(3):
        np.add.at(n, faces[:, k], fn)
    length = np.linalg.norm(n, axis=1, keepdims=True)
    length[length == 0] = 1
    return n / length


# ---------------------------------------------------------------- escrita

class Writer:
    def __init__(self):
        self.g = pygltflib.GLTF2(asset=pygltflib.Asset(generator="NanoAR optimize_models.py", version="2.0"))
        self.blob = bytearray()

    def view(self, data):
        while len(self.blob) % 4:
            self.blob.append(0)
        self.g.bufferViews.append(pygltflib.BufferView(buffer=0, byteOffset=len(self.blob), byteLength=len(data)))
        self.blob += data
        return len(self.g.bufferViews) - 1

    def accessor(self, ctype, count, typ, mn=None, mx=None, view=None):
        self.g.accessors.append(pygltflib.Accessor(bufferView=view, componentType=ctype, count=count, type=typ, min=mn, max=mx))
        return len(self.g.accessors) - 1

    def save(self, path, mesh_prims):
        self.g.meshes.append(pygltflib.Mesh(primitives=mesh_prims))
        self.g.nodes.append(pygltflib.Node(mesh=0))
        self.g.scenes.append(pygltflib.Scene(nodes=[0]))
        self.g.scene = 0
        self.g.buffers.append(pygltflib.Buffer(byteLength=len(self.blob)))
        self.g.set_binary_blob(bytes(self.blob))
        self.g.save_binary(path)


def optimize_geometry(name, ratio):
    gltf = pygltflib.GLTF2().load(os.path.join(SRC, name + ".glb"))
    blob = gltf.binary_blob()
    groups = collect(gltf, blob)
    w = Writer()
    w.g.extensionsUsed = [DRACO]
    w.g.extensionsRequired = [DRACO]
    prims, before, after = [], 0, 0
    for mat, parts in groups.values():
        pos, faces = weld(*merge(parts))
        before += len(faces)
        if ratio < 1 and len(faces) > 500:
            pos, faces = fast_simplification.simplify(pos.astype(np.float32), faces.astype(np.int32), target_reduction=1 - ratio)
            pos, faces = weld(np.asarray(pos, np.float64), np.asarray(faces, np.int64))
        after += len(faces)
        normals = vertex_normals(pos, faces)
        enc = DracoPy.encode(pos.astype(np.float32), faces.astype(np.uint32), quantization_bits=14, compression_level=7,
                             normals=normals.astype(np.float64), normal_quantization_bits=10)
        dec = DracoPy.decode(enc)  # contagens finais vêm do próprio Draco
        dpos = np.asarray(dec.points, np.float32).reshape(-1, 3)
        view = w.view(enc)
        a_pos = w.accessor(5126, len(dpos), "VEC3", dpos.min(0).tolist(), dpos.max(0).tolist())
        a_nrm = w.accessor(5126, len(dpos), "VEC3")
        a_idx = w.accessor(5125 if len(dpos) > 65535 else 5123, int(np.asarray(dec.faces).size), "SCALAR")
        if mat is not None:
            m = json.loads(mat.to_json())
            w.g.materials.append(pygltflib.Material.from_dict(m) if hasattr(pygltflib.Material, "from_dict")
                                 else pygltflib.Material(**m))
        prims.append(pygltflib.Primitive(
            attributes=pygltflib.Attributes(POSITION=a_pos, NORMAL=a_nrm), indices=a_idx,
            material=len(w.g.materials) - 1 if mat is not None else None,
            extensions={DRACO: {"bufferView": view, "attributes": {"POSITION": 0, "NORMAL": 1}}}))
    out = os.path.join(DST, name + ".glb")
    w.save(out, prims)
    return f"{len(groups)} material(is)/draw calls, {before} -> {after} triângulos"


def optimize_textures(name, max_size=1024, quality=82):
    """Mantém a malha; converte texturas para JPEG menores e reempacota o .glb."""
    gltf = pygltflib.GLTF2().load(os.path.join(SRC, name + ".glb"))
    blob = gltf.binary_blob()
    chunks = []
    for i, bv in enumerate(gltf.bufferViews):
        chunks.append(blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength])
    for img in gltf.images:
        if img.bufferView is None:
            continue
        im = Image.open(io.BytesIO(chunks[img.bufferView]))
        if im.mode in ("RGBA", "LA") and im.getextrema()[-1][0] < 255:
            continue  # tem transparência de verdade: mantém PNG
        im = im.convert("RGB")
        im.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True, progressive=False)
        chunks[img.bufferView] = buf.getvalue()
        img.mimeType = "image/jpeg"
    new = bytearray()
    for bv, data in zip(gltf.bufferViews, chunks):
        while len(new) % 4:
            new.append(0)
        bv.byteOffset = len(new)
        bv.byteLength = len(data)
        new += data
    gltf.buffers[0].byteLength = len(new)
    gltf.set_binary_blob(bytes(new))
    gltf.save_binary(os.path.join(DST, name + ".glb"))
    return f"texturas -> JPEG ≤{max_size}px"


def main():
    ratios = dict(DEFAULT_RATIOS)
    for arg in sys.argv[1:]:
        k, v = arg.split("=")
        ratios[k] = float(v)
    for name, ratio in ratios.items():
        src = os.path.join(SRC, name + ".glb")
        if not os.path.exists(src):
            print(f"{name}: {src} não encontrado, pulando")
            continue
        gltf = pygltflib.GLTF2().load(src)
        info = optimize_textures(name) if gltf.images else optimize_geometry(name, ratio)
        a, b = os.path.getsize(src), os.path.getsize(os.path.join(DST, name + ".glb"))
        print(f"{name:14s} {a / 1024:7.0f} KB -> {b / 1024:6.0f} KB   ({info})")


if __name__ == "__main__":
    main()
