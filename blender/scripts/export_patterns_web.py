"""blender -b ppf-panels.blend --python export_patterns_web.py -- <out dir> [<nest preview png>]

The car's main PPF pieces as flat cutting patterns, nested on one run of 1.52 m film (the v3 page cuts them all at
once, then the pieces lift off, grow to full size and fly onto the car):
  patterns.glb   the 13 panels (hood + 12), each centred on its centroid in car space (identity nodes, Draco);
                 TEXCOORD_0 = where each vertex lies in the nested layout (metres; x along the film, y across it)
  patterns.json  layout scale k, layout length, per panel its rest centre and burst direction (glTF axes),
                 per piece (connected component) its outline loops in layout coordinates
Each kept piece is flattened on its own (angle-based unwrap), rescaled to its true area, turned to its tightest
bounding box, then all are shelf-packed across the film. The layout is the real kit scaled by k so it fits the table.
glTF axes: Blender (x, y, z) -> (x, z, -y).
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
out_dir = args[0]
# (another car's kit, e.g. make_kit_911.py's, keeps its preview apart from the Urus's)
preview_path = args[1] if len(args) > 1 else os.path.join(out_dir, "..", "..", "blender", "ref", "nest-preview.png")
os.makedirs(out_dir, exist_ok=True)
sc = bpy.context.scene
sc.frame_set(1)
FILM_W = 1.52
MARGIN = 0.04            # film edge kept clear (m, layout scale)
GAP = 0.012              # between pieces (m, layout scale)
MAX_LEN = 2.12           # the layout must fit the cutting table
MIN_PIECE = 0.004        # m2 (true size): smaller bits stay on the panel but get no knife line


def gl(v, n=5):
    return [round(v.x, n), round(v.z, n), round(-v.y, n)]


panels = [bpy.data.objects["PPF_Hood"]] + sorted(
    (o for o in bpy.data.objects if o.name.startswith("PPF_Panel_")), key=lambda o: o.name)

col = bpy.data.collections.new("WEB_Patterns")
sc.collection.children.link(col)
work = []
for src in panels:
    me = src.data.copy()
    me.materials.clear()
    name = "Pat_" + src.name.replace("PPF_Panel_", "").replace("PPF_", "")
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    d = Vector(src["burst_dir"]) if src.name != "PPF_Hood" else Vector((0, 0.35, 1)).normalized()
    work.append({"src": src, "ob": ob, "rest": Vector(src["burst_c"]), "dir": d})

# ------------------------------------------------------------------ flatten: angle-based unwrap of every panel
for w in work:
    ob = w["ob"]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")


def poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def components(bm):
    bm.faces.ensure_lookup_table()
    seen, comps = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, cur = [f], []
        seen.add(f.index)
        while stack:
            x = stack.pop()
            cur.append(x)
            for e in x.edges:
                for nf in e.link_faces:
                    if nf.index not in seen:
                        seen.add(nf.index)
                        stack.append(nf)
        comps.append(cur)
    return comps


# Only the big, important pieces of each panel are kept (the page stays light): its largest component, plus any
# other component that is both large and close to it in size (the tailgate's two halves). Small trims and strips
# are dropped from the mesh too.
KEEP_MIN, KEEP_REL = 0.1, 0.4

# each kept component -> true-size flat shape at its tightest rotation (its own frame, bbox from the origin)
pieces = []           # {panel, verts: {vert: (x, y)}, size: (sx, sy), area, loops}
for wi, w in enumerate(work):
    bm = bmesh.new()
    bm.from_mesh(w["ob"].data)
    uvl = bm.loops.layers.uv.active
    w["bm"] = bm
    comps = components(bm)
    areas = [sum(f.calc_area() for f in c) for c in comps]
    top = max(areas)
    keep = [c for c, a in zip(comps, areas) if a == top or (a >= KEEP_MIN and a >= KEEP_REL * top)]
    drop = [f for c in comps if not any(c is k for k in keep) for f in c]
    for comp in keep:
        a3 = sum(f.calc_area() for f in comp)
        uv = {}
        for f in comp:
            for lp in f.loops:
                uv[lp.vert] = Vector(lp[uvl].uv)
        auv = sum(abs(poly_area([tuple(lp[uvl].uv) for lp in f.loops])) for f in comp)
        s = math.sqrt(a3 / auv) if auv > 1e-12 else 1.0
        c = sum(uv.values(), Vector((0, 0))) / len(uv)
        flat = {v: (p - c) * s for v, p in uv.items()}
        best = None
        for deg in range(0, 180, 2):
            r = math.radians(deg)
            cs, sn = math.cos(r), math.sin(r)
            xs = [p.x * cs - p.y * sn for p in flat.values()]
            ys = [p.x * sn + p.y * cs for p in flat.values()]
            box = (max(xs) - min(xs)) * (max(ys) - min(ys))
            if best is None or box < best[0]:
                best = (box, r, min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
        _, r, x0, y0, sx, sy = best
        cs, sn = math.cos(r), math.sin(r)
        verts = {v: (p.x * cs - p.y * sn - x0, p.x * sn + p.y * cs - y0) for v, p in flat.items()}
        # outline loops: boundary edges of this component, chained
        bedges = [e for f in comp for e in f.edges if e.is_boundary]
        adj = {}
        for e in set(bedges):
            a, b = e.verts
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        loops, used = [], set()
        for start in adj:
            if start in used:
                continue
            loop, prev, cur = [start], None, start
            used.add(start)
            while True:
                nxt = [v for v in adj[cur] if v is not prev and (v not in used or v is start)]
                if not nxt or nxt[0] is start:
                    break
                prev, cur = cur, nxt[0]
                loop.append(cur)
                used.add(cur)
            if len(loop) > 2:
                loops.append(loop)
        pieces.append({"panel": wi, "verts": verts, "size": (sx, sy), "area": a3, "loops": loops})
    w["drop"] = drop


# ------------------------------------------------------------------ nest every piece across the film (shelves)
def pack(k):
    """Shelf-pack all pieces scaled by k. Returns (length, placements) or None if a piece is wider than the film.
    Shelves run across the film (y); each shelf takes the length (x) of its longest piece."""
    usable = FILM_W - 2 * MARGIN
    items = []
    for i, p in enumerate(pieces):
        sx, sy = p["size"][0] * k, p["size"][1] * k
        # lay the long side across the film when it fits, so shelves stay short along the table
        if max(sx, sy) <= usable:
            turned = sx > sy
        elif min(sx, sy) <= usable:
            turned = sy > sx
        else:
            return None
        ex, ey = (sy, sx) if turned else (sx, sy)
        items.append((ex, ey, turned, i))
    items.sort(key=lambda t: -t[0])
    shelves = []          # [x_start, length, y_used, [placements]]
    x = 0.0
    place = {}
    for ex, ey, turned, i in items:
        for sh in shelves:
            if sh[2] + ey <= usable + 1e-9 and ex <= sh[1] + 1e-9:
                place[i] = (sh[0], MARGIN + sh[2], turned)
                sh[2] += ey + GAP
                break
        else:
            shelves.append([x, ex, ey + GAP, None])
            place[i] = (x, MARGIN, turned)
            x += ex + GAP
    return x - GAP, place


lo, hi = 0.15, 0.8
for _ in range(40):
    mid = (lo + hi) / 2
    res = pack(mid)
    if res and res[0] <= MAX_LEN:
        lo = mid
    else:
        hi = mid
K = round(lo, 4)
LENGTH, PLACE = pack(K)
print(f"NEST k={K} length={LENGTH:.3f} m pieces={len(pieces)} kit area={sum(p['area'] for p in pieces):.2f} m2")


def to_layout(i, xy):
    """piece-frame point (true size) -> layout (x along the film from its front edge, y across from the edge)"""
    p = pieces[i]
    x0, y0, turned = PLACE[i]
    x, y = xy[0] * K, xy[1] * K
    if turned:
        x, y = y, p["size"][0] * K - x
    return (x0 + x, y0 + y)


# write each vertex's layout position into the panel's UVs (glTF flips v; the page flips it back)
for w in work:
    w["bm"].loops.layers.uv.active  # noqa
for i, p in enumerate(pieces):
    w = work[p["panel"]]
    uvl = w["bm"].loops.layers.uv.active
    lay = {v: to_layout(i, xy) for v, xy in p["verts"].items()}
    p["lay"] = lay
    for v in lay:
        for lp in v.link_loops:
            lp[uvl].uv = lay[v]
for w in work:
    bm = w["bm"]
    if w["drop"]:
        bmesh.ops.delete(bm, geom=w["drop"], context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(w["ob"].data)
    w["ob"].data.update()

# ------------------------------------------------------------------ json + glb
data = {
    "k": K,
    "length": round(LENGTH, 4),
    "filmWidth": FILM_W,
    "panels": [{"name": w["ob"].name, "rest": gl(w["rest"]), "dir": gl(w["dir"])} for w in work],
    "pieces": [],
}
for i, p in enumerate(pieces):
    if p["area"] < MIN_PIECE:
        continue
    data["pieces"].append({
        "panel": p["panel"],
        "area": round(p["area"], 4),
        "loops": [[[round(c, 4) for c in p["lay"][v]] for v in loop] for loop in p["loops"]],
    })
with open(os.path.join(out_dir, "patterns.json"), "w", encoding="utf-8") as fh:
    json.dump(data, fh, separators=(",", ":"))
print("WROTE patterns.json", round(os.path.getsize(os.path.join(out_dir, "patterns.json")) / 1024), "KB,",
      len(data["pieces"]), "cut pieces")

for o in sc.objects:
    o.select_set(False)
for w in work:
    w["ob"].select_set(True)
path = os.path.join(out_dir, "patterns.glb")
bpy.ops.export_scene.gltf(
    filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
    export_animations=False, export_morph=False, export_extras=False, export_materials="NONE",
    export_texcoords=True, export_normals=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_texcoord_quantization=14,
)
print("WROTE patterns.glb", round(os.path.getsize(path) / 1024), "KB")

# preview of the nested layout for checking by eye
try:
    import numpy as np
    W_PX = 1400
    s = W_PX / FILM_W
    H_PX = int(LENGTH * s) + 20
    img = bpy.data.images.new("nest_preview", W_PX, H_PX, alpha=False)
    px = np.full((H_PX, W_PX, 4), (0.03, 0.08, 0.06, 1.0), dtype=np.float32)
    for pc in data["pieces"]:
        for loop in pc["loops"]:
            for a, b in zip(loop, loop[1:] + loop[:1]):
                n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * s) + 1
                for t in range(n + 1):
                    x = a[0] + (b[0] - a[0]) * t / n
                    y = a[1] + (b[1] - a[1]) * t / n
                    r_, c_ = int(x * s), int(y * s)
                    if 0 <= r_ < H_PX and 0 <= c_ < W_PX:
                        px[r_, c_] = (0.96, 0.7, 0.14, 1.0)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = preview_path
    img.file_format = "PNG"
    img.save()
    print("WROTE nest preview", img.filepath_raw)
except Exception as e:  # preview only
    print("preview skipped:", e)
