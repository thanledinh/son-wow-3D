"""Stage 3: PPF on every painted panel; the whole set bursts away from the car and comes back.

* Generates a film piece for every outward-facing painted panel of the Urus 'Paint' mesh that the hood/door pieces
  don't already cover (loose parts, welded, pushed out 2 mm).
* One shared material 'PPF_Applied': nearly invisible clear film; its 'Glow' value (keyframed) lights the pieces up
  with the brand's hex pattern while they are in the air.
* Burst: each piece flies out along its own average normal with a front-to-back stagger, drifts, then returns.
Re-runnable (regenerates PPF_Part_* objects, keeps PPF_Hood / PPF_Door_*).
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Euler

BURST_START, BURST_PEAK, MERGE_START, MERGE_END = 650, 676, 760, 790
OFFSET = 0.002
WELD = 0.002
rng = random.Random(7)

scene = bpy.context.scene
pcol = bpy.data.collections["PPF_Pieces"]
for o in list(pcol.objects):
    if o.name.startswith("PPF_Part_"):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me.users == 0:
            bpy.data.meshes.remove(me)

# ------------------------------------------------------------------ shared applied-film material with a Glow control
m = bpy.data.materials.get("PPF_Applied") or bpy.data.materials.new("PPF_Applied")
m.use_nodes = True
nt = m.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
b = nt.nodes.new("ShaderNodeBsdfPrincipled")
b.inputs["Base Color"].default_value = (0.92, 0.97, 1.0, 1)
b.inputs["Roughness"].default_value = 0.04
b.inputs["Coat Weight"].default_value = 1.0
glow = nt.nodes.new("ShaderNodeValue")
glow.name = "Glow"
glow.outputs[0].default_value = 0.0
# alpha: 0.10 at rest, up to 0.55 while glowing
ma = nt.nodes.new("ShaderNodeMapRange")
ma.inputs["To Min"].default_value = 0.10
ma.inputs["To Max"].default_value = 0.55
nt.links.new(glow.outputs[0], ma.inputs["Value"])
nt.links.new(ma.outputs["Result"], b.inputs["Alpha"])
# hex edges glow in the brand gold/cyan
tc = nt.nodes.new("ShaderNodeTexCoord")
vor = nt.nodes.new("ShaderNodeTexVoronoi")
vor.feature = "DISTANCE_TO_EDGE"
vor.inputs["Scale"].default_value = 22.0
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (1.0, 0.72, 0.2, 1)
ramp.color_ramp.elements[1].position = 0.05
ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1)
mul = nt.nodes.new("ShaderNodeMath")
mul.operation = "MULTIPLY"
mul.inputs[1].default_value = 3.0
nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
nt.links.new(glow.outputs[0], mul.inputs[0])
nt.links.new(mul.outputs[0], b.inputs["Emission Strength"])
nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
m.surface_render_method = "DITHERED"
m.use_backface_culling = False
m.diffuse_color = (0.92, 0.97, 1.0, 0.25)

# ------------------------------------------------------------------ find the painted panels not yet covered
src = bpy.data.objects["Paint"]
bm_src = bmesh.new()
bm_src.from_mesh(src.data)
bm_src.transform(src.matrix_world)
bm_src.faces.ensure_lookup_table()
seen = set()
comps = []
for f in bm_src.faces:
    if f.index in seen:
        continue
    stack, faces = [f], []
    seen.add(f.index)
    while stack:
        cur = stack.pop()
        faces.append(cur)
        for e in cur.edges:
            for nf in e.link_faces:
                if nf.index not in seen:
                    seen.add(nf.index)
                    stack.append(nf)
    area = sum(x.calc_area() for x in faces)
    nrm = sum((x.normal * x.calc_area() for x in faces), Vector())
    cen = sum((x.calc_center_median() * x.calc_area() for x in faces), Vector()) / max(area, 1e-9)
    lo = Vector((min(v.co.x for x in faces for v in x.verts), min(v.co.y for x in faces for v in x.verts),
                 min(v.co.z for x in faces for v in x.verts)))
    hi = Vector((max(v.co.x for x in faces for v in x.verts), max(v.co.y for x in faces for v in x.verts),
                 max(v.co.z for x in faces for v in x.verts)))
    comps.append({"faces": [x.index for x in faces], "area": area, "n": nrm.normalized() if nrm.length else nrm,
                  "c": cen, "lo": lo, "hi": hi})


def covered(k):
    c, nv = k["c"], k["n"]
    if abs(c.x) < 0.2 and abs(c.y - 1.72) < 0.15 and k["area"] > 1.5:          # hood
        return True
    if abs(c.x) > 0.6 and -1.37 <= k["lo"].y and k["hi"].y <= 0.94 and 0.36 <= k["lo"].z and k["hi"].z <= 1.26 \
            and abs(nv.x) > 0.85:                                                  # doors (as picked before)
        return True
    return False


picked = [k for k in comps
          if k["area"] > 0.012 and k["n"].z > -0.35 and len(k["faces"]) / k["area"] < 3000 and k["c"].z > 0.22
          and not covered(k)]

# ------------------------------------------------------------------ build the pieces
uv_src = bm_src.loops.layers.uv.active
made = []
for i, k in enumerate(sorted(picked, key=lambda k: -k["c"].y)):
    bm = bmesh.new()
    vmap = {}
    for fi in k["faces"]:
        f = bm_src.faces[fi]
        vs = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = bm.verts.new(v.co)
            vs.append(vmap[v.index])
        try:
            bm.faces.new(vs)
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * OFFSET
    me = bpy.data.meshes.new(f"PPF_Part_{i:03d}")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(me.name, me)
    pcol.objects.link(ob)
    ob["burst_dir"] = list(k["n"])
    ob["burst_c"] = list(k["c"])
    made.append(ob)
bm_src.free()

# the hood/door pieces join the set
pieces = made + [bpy.data.objects[n] for n in ("PPF_Hood", "PPF_Door_FL", "PPF_Door_FR", "PPF_Door_RL", "PPF_Door_RR")]
for ob in pieces:
    if "burst_dir" not in ob:
        me = ob.data
        nrm = sum((p.normal * p.area for p in me.polygons), Vector())
        cen = sum((p.center * p.area for p in me.polygons), Vector()) / max(sum(p.area for p in me.polygons), 1e-9)
        ob["burst_dir"] = list((ob.matrix_world.to_3x3() @ nrm).normalized())
        ob["burst_c"] = list(ob.matrix_world @ cen)
    ob.data.materials.clear()
    ob.data.materials.append(m)

# ------------------------------------------------------------------ burst keyframes
from mathutils import Matrix

# each piece rotates about its own centre: move the mesh origin to the centroid first
for ob in pieces:
    # (read the mesh itself: hidden objects' matrix_world is not refreshed by the depsgraph)
    c = Vector(ob["burst_c"])
    me = ob.data
    mc = sum((p.center * p.area for p in me.polygons), Vector()) / max(1e-9, sum(p.area for p in me.polygons))
    if mc.length > 1e-3:
        me.transform(Matrix.Translation(-mc))
    ob.location = c

ys = [ob["burst_c"][1] for ob in pieces]
ymin, ymax = min(ys), max(ys)
for ob in pieces:
    ob.rotation_mode = "XYZ"
    d = Vector(ob["burst_dir"])
    c = Vector(ob["burst_c"])
    # mostly outward, with a lift so nothing dives into the floor
    dirn = (d + Vector((0, 0, 0.35))).normalized()
    dist = 0.45 + 0.35 * rng.random() + 0.25 * abs(d.z)
    stagger = int(10 * (ymax - c.y) / max(1e-6, ymax - ymin))          # front of the car goes first
    back = int(10 * (c.y - ymin) / max(1e-6, ymax - ymin))
    rot = Euler((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(-0.35, 0.35)))
    f0, f1 = BURST_START + stagger, BURST_PEAK + stagger
    for f, off, r in ((1, Vector(), Euler()), (f0, Vector(), Euler()), (f1, dirn * dist, rot),
                      (MERGE_START + back, dirn * (dist * 1.12), Euler((rot.x * 1.3, rot.y * 1.3, rot.z * 1.3))),
                      (MERGE_END + back, Vector(), Euler())):
        ob.location = c + off
        ob.rotation_euler = r
        ob.keyframe_insert("location", frame=f)
        ob.keyframe_insert("rotation_euler", frame=f)
    ob.location = c
    ob.rotation_euler = (0, 0, 0)

glow_sock = nt.nodes["Glow"].outputs[0]
nt.animation_data_clear()
for f, v in ((1, 0.0), (BURST_START - 2, 0.0), (BURST_START + 8, 1.0), (MERGE_END + 6, 1.0), (MERGE_END + 26, 0.0)):
    glow_sock.default_value = v
    glow_sock.keyframe_insert("default_value", frame=f)

scene.frame_end = max(scene.frame_end, MERGE_END + 60)
scene.frame_set(1)
bpy.ops.wm.save_mainfile()
print(f"generated {len(made)} new panel pieces; burst set {len(pieces)} pieces; "
      f"total film area {sum(sum(p.area for p in ob.data.polygons) for ob in pieces):.2f} m2")
