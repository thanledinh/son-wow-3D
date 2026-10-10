"""blender -b ppf-panels.blend --python export_web.py -- <public/models dir>
Exports the film pieces for the website (car space = the Urus GLB root: glTF Y up, nose at -Z):
  plotter.glb    ZAPPA M-1600 + cutting table + roll, joined by part: Plotter_Body, Plotter_Carriage, Plotter_Roll
  ppf-panels.glb hood + 12 body panels, each centred on its centroid, extras.dir = burst direction (glTF axes)
  hood-fly.glb   the cut hood piece (flat) with morph target OnHood, plus empty HoodFlyStart = its pose on the table
  cut.json       the knife outline on the table (glTF coords, cut order) + machine constants
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)
sc = bpy.context.scene
SEP, APPLY_END = 312, 604


def gl(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


def fresh_collection(name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c


def baked_copy(o, coll, dg, name=None, offset=None):
    """World-space mesh copy of any renderable object (modifiers, curves and text baked)."""
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
    m = o.matrix_world.copy()
    if offset is not None:
        m = Matrix.Translation(-offset) @ m
    me.transform(m)
    ob = bpy.data.objects.new(name or (o.name + "_w"), me)
    coll.objects.link(ob)
    return ob


def join(objs, name):
    objs = [o for o in objs if o.type == "MESH" and len(o.data.polygons)]
    if not objs:
        return None
    with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def export(coll, path, morph=False, extras=False):
    for o in sc.objects:
        o.select_set(False)
    for o in coll.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_animations=False, export_morph=morph, export_morph_normal=False, export_extras=extras,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_image_format="AUTO",
    )
    print("EXPORTED", path, round(os.path.getsize(path) / 1024), "KB")


# ------------------------------------------------------------------ 1. plotter
sc.frame_set(1)
dg = bpy.context.evaluated_depsgraph_get()
pc = fresh_collection("WEB_Plotter")
skip_types = {"EMPTY", "CAMERA", "LIGHT"}
cnc = [o for o in bpy.data.collections["CNC_M1600"].all_objects if o.type not in skip_types and not o.hide_render]
table = [o for o in bpy.data.collections["Film_Rig"].all_objects if o.name.startswith("CutTable_")]
roll_src = [o for o in bpy.data.collections["Film_Rig"].all_objects if o.name.startswith("Film_Roll")]
carriage_src = [o for o in cnc if o.name.startswith("Carriage_")]
body_src = [o for o in cnc if o not in carriage_src] + table
body = join([baked_copy(o, pc, dg) for o in body_src], "Plotter_Body")
carriage = join([baked_copy(o, pc, dg) for o in carriage_src], "Plotter_Carriage")
# the roll keeps its own pivot (its axis) so the page can spin it
rb = [baked_copy(o, pc, dg) for o in roll_src]
lo = Vector((min(v.co.x for o in rb for v in o.data.vertices), min(v.co.y for o in rb for v in o.data.vertices),
             min(v.co.z for o in rb for v in o.data.vertices)))
hi = Vector((max(v.co.x for o in rb for v in o.data.vertices), max(v.co.y for o in rb for v in o.data.vertices),
             max(v.co.z for o in rb for v in o.data.vertices)))
roll_c = (lo + hi) / 2
for o in rb:
    o.data.transform(Matrix.Translation(-roll_c))
roll = join(rb, "Plotter_Roll")
roll.location = roll_c
export(pc, os.path.join(out_dir, "plotter.glb"))
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (body, carriage, roll) if o)
print("PLOTTER tris", tris)

# ------------------------------------------------------------------ 2. PPF panels for the burst
sc.frame_set(1)
kc = fresh_collection("WEB_Panels")
for o in [bpy.data.objects["PPF_Hood"]] + sorted((o for o in bpy.data.objects if o.name.startswith("PPF_Panel_")),
                                                 key=lambda o: o.name):
    me = o.data.copy()
    ob = bpy.data.objects.new(o.name.replace("PPF_", ""), me)
    kc.objects.link(ob)
    ob.location = Vector(o["burst_c"])
    d = Vector(o["burst_dir"]) if o.name != "PPF_Hood" else Vector((0, 0.35, 1)).normalized()
    ob["dir"] = gl(d)
export(kc, os.path.join(out_dir, "ppf-panels.glb"), extras=True)

# ------------------------------------------------------------------ 3. the flying hood piece + 4. the cut outline
film = bpy.data.objects["PPF_HoodFilm"]
sc.frame_set(APPLY_END)
m_end = film.matrix_world.copy()
sc.frame_set(SEP)
m_sep = film.matrix_world.copy()
fc = fresh_collection("WEB_HoodFly")
me = film.data.copy()
fly = bpy.data.objects.new("HoodFly", me)
fc.objects.link(fly)
fly.matrix_world = m_end
for kb in list(me.shape_keys.key_blocks):
    if kb.name not in ("Basis", "OnHood"):
        fly.shape_key_remove(kb)
start = bpy.data.objects.new("HoodFlyStart", None)
fc.objects.link(start)
start.matrix_world = m_sep
export(fc, os.path.join(out_dir, "hood-fly.glb"), morph=True)

# outline = boundary loop of the flat piece, in its pose on the table, from its car-side end
bm = bmesh.new()
bm.from_mesh(film.data)          # Basis (flat)
bound = [e for e in bm.edges if e.is_boundary]
adj = {}
for e in bound:
    a, b = e.verts
    adj.setdefault(a, []).append(b)
    adj.setdefault(b, []).append(a)
pts_w = {v: m_sep @ v.co for v in adj}
start_v = max(adj, key=lambda v: pts_w[v].x)
loop, prev, cur = [start_v], None, start_v
while True:
    nxt = [v for v in adj[cur] if v is not prev]
    if not nxt or nxt[0] is start_v:
        break
    prev, cur = cur, nxt[0]
    loop.append(cur)
step = max(1, len(loop) // 320)
outline = [gl(pts_w[v]) for v in loop[::step]]
outline.append(outline[0])
bm.free()

root = bpy.data.objects["CNC_M1600"]
blade_world = root.matrix_world @ Vector((0.900, -0.038, 1.17))
cut = {
    "outline": outline,
    "bladeX": round(blade_world.x, 4),           # glTF x == Blender x
    "carriageRestZ": round(-blade_world.y, 4),   # glTF z of the blade when the carriage is parked
    "tableTopY": 0.9985,
    "filmWidth": 1.52,
    "filmCenterZ": -0.6,
    "tableEndX": -1.58,
    "rollRadius": 0.0605,
}
with open(os.path.join(out_dir, "cut.json"), "w", encoding="utf-8") as f:
    json.dump(cut, f)
print("CUT outline points", len(outline), "blade", cut["bladeX"], cut["carriageRestZ"])
