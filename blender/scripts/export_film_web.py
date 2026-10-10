"""blender -b ppf-panels.blend --python export_film_web.py -- <out dir>

Bakes the PPF film (frames 1-1310 @ 24 fps) for the v2 website, which replays it in real time with three.js:
  film.glb   the animated pieces as plain meshes in their own local frames (identity nodes, Draco), morph targets
             for the shape-keyed ones (hood film, the five layers, the liner's peel)
  film.json  per frame: camera (eye, target, lens), every piece's world transform / visibility / morph weights,
             the animated material values (knife reveal, film alpha, glow, scratches, heal, heat), the plotter feed
             and carriage; plus the film path the strip and knife line follow (curve-deformed in the browser)
glTF axes: Blender (x, y, z) -> (x, z, -y). The Urus sits at the origin, so car space == film world.
"""
import bisect
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)
sc = bpy.context.scene
F0, F1 = 1, 1310
FRAMES = range(F0, F1 + 1)
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))   # Blender -> glTF axes
CI = C.inverted()


def r(x, n=4):
    v = round(x, n)
    return 0 if v == 0 else v


def gl(v, n=4):
    return [r(v.x, n), r(v.z, n), r(-v.y, n)]


# ------------------------------------------------------------------ what moves
PIECES = {
    "HoodFilm": "PPF_HoodFilm",
    "L1": "Layer_L1_TopCoat", "L2": "Layer_L2_Gloss", "L3": "Layer_L3_TPU", "L4": "Layer_L4_Adhesive",
    "L5": "Layer_L5_Liner",
    "Key": "Scratch_Key", "KeyHead": "Scratch_KeyHead",
    "Scratch": "PPF_ScratchLayer", "Heat": "PPF_HeatGlow",
    "Hood": "PPF_Hood",
}
for o in sorted(bpy.data.objects, key=lambda o: o.name):
    if o.name.startswith("PPF_Panel_"):
        PIECES[o.name.replace("PPF_Panel_", "Panel_")] = o.name
objs = {k: bpy.data.objects[v] for k, v in PIECES.items()}


def fcurves_of(id_):
    ad = getattr(id_, "animation_data", None)
    if not ad or not ad.action:
        return []
    act = ad.action
    try:
        return list(act.fcurves)
    except AttributeError:
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out += list(cb.fcurves)
        return out


def curve_track(id_, path, index=0):
    for fc in fcurves_of(id_):
        if fc.data_path == path and fc.array_index == index:
            return [fc.evaluate(f) for f in FRAMES]
    raise KeyError(f"{id_.name}: no fcurve {path}[{index}]")


def node_track(mat_name, node_name, socket=None):
    mat = bpy.data.materials[mat_name]
    if socket is None:
        path = f'nodes["{node_name}"].outputs[0].default_value'
    else:
        path = f'nodes["{node_name}"].inputs[{socket}].default_value'
    return curve_track(mat.node_tree, path)


# ------------------------------------------------------------------ material / light values (straight from the fcurves)
cut_m = bpy.data.materials["PPF_CutLine"]
film_m = bpy.data.materials["PPF_FilmSheet"]
film_bsdf = next(n for n in film_m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
alpha_idx = list(film_bsdf.inputs).index(film_bsdf.inputs["Alpha"])
scalars = {
    "reveal": node_track("PPF_CutLine", "Reveal"),
    "filmAlpha": node_track("PPF_FilmSheet", film_bsdf.name, alpha_idx),
    "glow": node_track("PPF_Applied", "Glow"),
    "scr0": node_track("PPF_Scratches", "Reveal0"),
    "scr1": node_track("PPF_Scratches", "Reveal1"),
    "scr2": node_track("PPF_Scratches", "Reveal2"),
    "heal": node_track("PPF_Scratches", "Heal"),
    "heat": node_track("PPF_HeatGlow", "Heat"),
    "exposure": curve_track(sc, "view_settings.exposure"),
    "feed": curve_track(bpy.data.objects["Film_Feed"], "location", 0),
    "machineLight": [v / 380.0 for v in curve_track(bpy.data.objects["Studio_Machine"].data, "energy")],
    "carLight": [v / 900.0 for v in curve_track(bpy.data.objects["Studio_Key"].data, "energy")],
}

# ------------------------------------------------------------------ per-frame sampling of transforms, visibility, weights
cam = bpy.data.objects["FilmCam"]
tgt = bpy.data.objects["CamTarget"]
rig = bpy.data.objects["Carriage_Rig"]
strip = bpy.data.objects["Film_Strip"]
cutline = bpy.data.objects["Film_CutLine"]
table = bpy.data.objects["CutTable_Top"]
hole_mod = strip.modifiers["PieceHole"]
labels = sorted((o for o in bpy.data.objects if o.name.startswith("Label_L")), key=lambda o: o.name)

eye, target, lens = [], [], []
carriage = []
vis = {k: [] for k in list(PIECES) + ["machine", "strip", "cutline", "hole", "labels"]}
xf = {k: [] for k in PIECES}
wts = {k: [] for k, o in objs.items() if o.data.shape_keys}
rig0 = None
label_pos = None
for f in FRAMES:
    sc.frame_set(f)
    eye.append(cam.matrix_world.translation.copy())
    target.append(tgt.matrix_world.translation.copy())
    lens.append(cam.data.lens)
    t = rig.matrix_world.translation.copy()
    rig0 = rig0 or t
    carriage.append(t - rig0)
    for k, o in objs.items():
        vis[k].append(not o.hide_render)
        m = C @ o.matrix_world @ CI
        loc, q, s = m.decompose()
        xf[k].append((loc, q, s))
        if k in wts:
            wts[k].append([kb.value for kb in o.data.shape_keys.key_blocks[1:]])
    vis["machine"].append(not table.hide_render)
    vis["strip"].append(not strip.hide_render)
    vis["cutline"].append(not cutline.hide_render)
    vis["hole"].append(bool(hole_mod.show_render))
    vis["labels"].append(not labels[0].hide_render)
    if f == 470:
        label_pos = [gl(o.matrix_world.translation) for o in labels]


def runs(flags):
    out, start = [], None
    for i, on in enumerate(flags):
        f = F0 + i
        if on and start is None:
            start = f
        if not on and start is not None:
            out.append([start, f - 1])
            start = None
    if start is not None:
        out.append([start, F1])
    return out


def scalar_track(vals, n=4):
    """Constant outside [from, to]; per-frame values inside."""
    lo = next((i for i in range(1, len(vals)) if abs(vals[i] - vals[i - 1]) > 1e-6), None)
    if lo is None:
        return {"c": r(vals[0], n)}
    hi = max(i for i in range(1, len(vals)) if abs(vals[i] - vals[i - 1]) > 1e-6)
    a, b = lo - 1, hi
    return {"from": F0 + a, "to": F0 + b, "v": [r(v, n) for v in vals[a:b + 1]]}


def moving(seq, same):
    """Index range [i0, i1] of seq outside which the value never changes (None if it never changes)."""
    idx = [i for i in range(1, len(seq)) if not same(seq[i], seq[i - 1])]
    return (idx[0] - 1, idx[-1]) if idx else None


def piece_track(k):
    """World transform (+ morph weights) while the piece is shown; stored only over the frames where it changes,
    a single value when it never moves."""
    shown = [i for i, on in enumerate(vis[k]) if on]
    out = {"vis": runs(vis[k])}
    if not shown:
        return out
    a, b = shown[0], shown[-1]
    seq = xf[k][a:b + 1]
    same_t = lambda p, q: (p[0] - q[0]).length < 1e-5 and p[1].rotation_difference(q[1]).angle < 1e-5
    pack = lambda p: [r(p[0].x), r(p[0].y), r(p[0].z), r(p[1].x, 5), r(p[1].y, 5), r(p[1].z, 5), r(p[1].w, 5)]
    out["scale"] = [r(seq[0][2].x), r(seq[0][2].y), r(seq[0][2].z)]
    mv = moving(seq, same_t)
    if mv is None:
        out["T"] = {"c": pack(seq[0])}
    else:
        flat = []
        prev = None
        for p in seq[mv[0]:mv[1] + 1]:
            q = p[1]
            if prev is not None and prev.dot(q) < 0:      # keep the quaternion hemisphere continuous for lerping
                q = -q
            prev = q
            flat += pack((p[0], q, p[2]))
        out["T"] = {"from": F0 + a + mv[0], "to": F0 + a + mv[1], "v": flat}
    if k in wts:
        names = [kb.name for kb in objs[k].data.shape_keys.key_blocks[1:]]
        seqw = wts[k][a:b + 1]
        mw = moving(seqw, lambda p, q: max(abs(x - y) for x, y in zip(p, q)) < 1e-6)
        if mw is None:
            out["W"] = {"names": names, "c": [r(x) for x in seqw[0]]}
        else:
            out["W"] = {"names": names, "from": F0 + a + mw[0], "to": F0 + a + mw[1],
                        "v": [r(x) for w in seqw[mw[0]:mw[1] + 1] for x in w]}
    return out


# ------------------------------------------------------------------ the plotter film path (strip + knife line deform in JS)
path_ob = bpy.data.objects["Film_Path"]
pathf = bpy.data.objects["Film_PathFrame"]
pts = [Vector((p.co.x, p.co.y)) for p in path_ob.data.splines[0].points]
S = [0.0]
for i in range(1, len(pts)):
    S.append(S[-1] + (pts[i] - pts[i - 1]).length)
Mp = pathf.matrix_world.copy()


def path_at(s):
    s = min(max(s, 0.0), S[-1])
    i = max(1, min(len(S) - 1, bisect.bisect_left(S, s)))
    seg = S[i] - S[i - 1]
    k = (s - S[i - 1]) / seg if seg > 1e-12 else 0.0
    p = pts[i - 1].lerp(pts[i], k)
    t = (pts[i] - pts[i - 1]).normalized()
    return p, t


def deform(co, F):
    p, t = path_at(co.x + F)
    n = Vector((-t.y, t.x))
    q = p + n * co.y
    return Mp @ Vector((q.x, q.y, co.z))


# check the JS-style deform against Blender's own curve modifier
dg = bpy.context.evaluated_depsgraph_get()
errs = []
for f in (90, 200, 290):
    sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = strip.evaluated_get(dg)
    F = strip.parent.matrix_basis.translation.x
    mw = ev.matrix_world
    base = strip.data.vertices
    evv = ev.data.vertices
    if len(evv) != len(base):
        errs.append(("vertex count differs", f))
        continue
    errs.append(max((mw @ evv[i].co - deform(base[i].co, F)).length for i in range(0, len(base), 7)))
print("PATH DEFORM max error (m):", errs)

# strip: a ribbon from x_back to x_front, n segments, across the 1.52 m width (rebuilt in JS)
xs = [v.co.x for v in strip.data.vertices]
zs = [v.co.z for v in strip.data.vertices]
strip_info = {"x0": r(min(xs), 5), "x1": r(max(xs), 5), "n": len(xs) // 2 - 1, "z0": r(min(zs), 5), "z1": r(max(zs), 5)}

# knife line: pairs of vertices along the outline, each pair carries the outline 'progress'
me = cutline.data
prog = me.attributes["progress"].data
outline = []
for i in range(0, len(me.vertices) - 1, 2):
    a, b = me.vertices[i].co, me.vertices[i + 1].co
    m = (a + b) / 2
    outline.append([r(m.x, 5), r(m.y, 5), r(m.z, 5), r(prog[i].value, 5)])

film = {
    "fps": 24,
    "frames": [F0, F1],
    "cuts": [65, 129, 177, 313, 529, 1121],
    "camera": {
        "eye": [x for v in eye for x in gl(v)],
        "target": [x for v in target for x in gl(v)],
        "lens": [r(x, 3) for x in lens],
        "sensor": 36.0,
    },
    "carriage": [x for v in carriage for x in gl(v)],
    "scalars": {k: scalar_track(v) for k, v in scalars.items()},
    # (Film_Strip itself is keyed hidden in the .blend by mistake; the page shows it with the plotter)
    "vis": {k: runs(vis[k]) for k in ("machine", "cutline", "hole", "labels")},
    "pieces": {k: piece_track(k) for k in PIECES},
    "labels": [{"text": o.data.body, "pos": p} for o, p in zip(labels, label_pos)],
    "path": {
        "pts": [x for p in pts for x in (r(p.x, 5), r(p.y, 5))],
        "matrix": [r(x, 6) for row in (C @ Mp) for x in row],   # path plane (u, w, k) -> glTF world, row-major
        "strip": strip_info,
        "outline": outline,
        "rollRadius": 0.0605,
    },
}
# the scratch layer's UV box (film_4_scratch_heal.py): the hood at rest, seen from above
sc.frame_set(840)
hw = [bpy.data.objects["PPF_Hood"].matrix_world @ v.co for v in bpy.data.objects["PPF_Hood"].data.vertices]
film["hoodUV"] = [r(min(p.x for p in hw), 5), r(max(p.x for p in hw), 5), r(min(p.y for p in hw), 5), r(max(p.y for p in hw), 5)]

with open(os.path.join(out_dir, "film.json"), "w", encoding="utf-8") as fh:
    json.dump(film, fh, ensure_ascii=False, separators=(",", ":"))
print("WROTE film.json", round(os.path.getsize(os.path.join(out_dir, "film.json")) / 1024), "KB")

# ------------------------------------------------------------------ meshes (local frames, identity nodes)
sc.frame_set(1)
dg = bpy.context.evaluated_depsgraph_get()
col = bpy.data.collections.new("WEB_Film")
sc.collection.children.link(col)
for k, o in objs.items():
    if o.data.shape_keys:
        me2 = o.data.copy()                      # keeps the shape keys (exported as morph targets)
    else:
        me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
    me2.materials.clear()
    ob2 = bpy.data.objects.new("F_" + k, me2)      # prefixed: never collides with a name already in the file
    col.objects.link(ob2)
    ob2.matrix_world = Matrix.Identity(4)
for o in sc.objects:
    o.select_set(False)
for o in col.objects:
    o.select_set(True)
path = os.path.join(out_dir, "film.glb")
bpy.ops.export_scene.gltf(
    filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
    export_animations=False, export_morph=True, export_morph_normal=True, export_extras=False,
    export_materials="NONE", export_texcoords=False, export_normals=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
)
print("WROTE film.glb", round(os.path.getsize(path) / 1024), "KB")
for k, v in film["pieces"].items():
    print(" ", k, "vis", v["vis"], "T", "static" if "c" in v.get("T", {}) else (v.get("T", {}).get("from"), v.get("T", {}).get("to")),
          "W", v.get("W", {}).get("names"))
print("SCALARS", {k: (v.get("from"), v.get("to")) if "v" in v else v["c"] for k, v in film["scalars"].items()})
print("VIS", film["vis"])
print("LABELS", film["labels"])
