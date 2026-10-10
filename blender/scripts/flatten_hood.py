"""Flatten the hood PPF piece into its real-size 2D cutting pattern (same topology, so the flat and the
draped shapes can be blended with shape keys later)."""
import math
import bpy
from mathutils import Vector, Matrix

SRC = "PPF_Hood"
src = bpy.data.objects[SRC]
anim = bpy.data.collections.get("PPF_Anim")
if anim is None:
    anim = bpy.data.collections.new("PPF_Anim")
    bpy.context.scene.collection.children.link(anim)

me = src.data.copy()
tmp = bpy.data.objects.new("tmp_unwrap", me)
bpy.context.scene.collection.objects.link(tmp)
win = bpy.context.window_manager.windows[0]
area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
region = next(r for r in area.regions if r.type == "WINDOW")
for o in bpy.context.view_layer.objects:
    o.select_set(False)
tmp.select_set(True)
bpy.context.view_layer.objects.active = tmp
used = None
with bpy.context.temp_override(window=win, area=area, region=region, active_object=tmp, object=tmp,
                               selected_objects=[tmp], selected_editable_objects=[tmp]):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    for method in ("MINIMUM_STRETCH", "CONFORMAL", "ANGLE_BASED"):
        try:
            bpy.ops.uv.unwrap(method=method, margin=0.0)
            used = method
            break
        except Exception as e:  # older/newer enum names
            print("unwrap", method, "failed:", e)
    bpy.ops.object.mode_set(mode="OBJECT")

uvl = me.uv_layers.active.data
uv = [None] * len(me.vertices)
for poly in me.polygons:
    for li in poly.loop_indices:
        uv[me.loops[li].vertex_index] = Vector(uvl[li].uv)

# real-size scale: match the 3D area
a3 = sum(p.area for p in me.polygons)
a2s = 0.0
for p in me.polygons:
    pts = [uv[v] for v in p.vertices]
    for i in range(1, len(pts) - 1):
        a2s += ((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2
k = math.sqrt(a3 / abs(a2s))
mirror = a2s < 0  # keep the film's top face pointing +Z

c = sum(uv, Vector((0, 0))) / len(uv)
P = [(q - c) * k for q in uv]
if mirror:
    P = [Vector((-q.x, q.y)) for q in P]
# principal axis -> X
sxx = sum(q.x * q.x for q in P)
syy = sum(q.y * q.y for q in P)
sxy = sum(q.x * q.y for q in P)
ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
R = Matrix.Rotation(-ang, 2)
P = [R @ q for q in P]

flat_me = src.data.copy()
flat_me.name = "PPF_Hood_Flat"
for v, q in zip(flat_me.vertices, P):
    v.co = (q.x, q.y, 0.0)
flat_me.update()
old = bpy.data.objects.get("PPF_Hood_Flat")
if old:
    bpy.data.objects.remove(old, do_unlink=True)
flat = bpy.data.objects.new("PPF_Hood_Flat", flat_me)
anim.objects.link(flat)
flat.location = (0.0, 0.0, 0.0)

# distortion report: edge-length ratio flat / 3D
ratios = []
for e in me.edges:
    a, b = e.vertices
    l3 = (me.vertices[a].co - me.vertices[b].co).length
    l2 = (P[a] - P[b]).length
    if l3 > 1e-5:
        ratios.append(l2 / l3)
ratios.sort()
xs = [q.x for q in P]
ys = [q.y for q in P]
bpy.data.objects.remove(tmp, do_unlink=True)
bpy.data.meshes.remove(me)
flat.hide_set(True)
bpy.ops.wm.save_mainfile()
print(f"unwrap={used} mirror={mirror} scale={k:.4f}")
print(f"flat size {max(xs)-min(xs):.3f} x {max(ys)-min(ys):.3f} m; area {a3:.3f} m2")
print(f"edge stretch: median {ratios[len(ratios)//2]:.4f}  p5 {ratios[len(ratios)//20]:.4f}  p95 {ratios[-len(ratios)//20]:.4f}")
