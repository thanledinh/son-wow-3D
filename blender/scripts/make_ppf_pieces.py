"""Cut PPF pieces out of the Urus 'Paint' shell: each piece is one loose part of the paint
(the car's own panel), copied and pushed out along its normals so it sits on the paint."""
import bpy
import bmesh
from mathutils import Vector

OFFSET = 0.002  # 2 mm above the paint so it never z-fights (real film is ~0.2 mm)

WELD = 0.002    # the export split each panel at its creases; touching edges get welded back

# +Y is the nose, +X is the car's right side.
# The export split each door skin into several loose parts (main skin, lower strip, arch edge...),
# and the two sides are not split identically, so doors are picked by rule: every part inside
# the door's box whose surface faces outward. Handles (very dense mesh), door edges and the
# downward-facing undersides fail the rule on purpose: the film goes on the outer skin.
DOOR_Y = {"F": (-0.26, 0.94), "R": (-1.37, -0.17)}
DOOR_Z = (0.36, 1.26)


def door_rule(side, which):
    s = -1 if side == "L" else 1
    y0, y1 = DOOR_Y[which]

    def ok(k):
        return (k["lo"].y >= y0 and k["hi"].y <= y1 and k["lo"].z >= DOOR_Z[0] and k["hi"].z <= DOOR_Z[1]
                and k["center"].x * s > 0.6 and k["normal"].x * s > 0.85
                and k["area"] > 0.009 and len(k["faces"]) / k["area"] < 3000)
    return ok


TARGETS = {
    "PPF_Hood":    [((0.00, 1.72, 1.05), 2.072)],
    "PPF_Door_FL": door_rule("L", "F"),
    "PPF_Door_FR": door_rule("R", "F"),
    "PPF_Door_RL": door_rule("L", "R"),
    "PPF_Door_RR": door_rule("R", "R"),
}

src = bpy.data.objects["Paint"]

col = bpy.data.collections.get("PPF_Pieces")
if col is None:
    col = bpy.data.collections.new("PPF_Pieces")
    bpy.context.scene.collection.children.link(col)
for o in list(col.objects):
    bpy.data.objects.remove(o, do_unlink=True)

mat = bpy.data.materials.get("PPF_Preview") or bpy.data.materials.new("PPF_Preview")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF") or next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.35, 0.9, 1.0, 1.0)
bsdf.inputs["Roughness"].default_value = 0.08
bsdf.inputs["Alpha"].default_value = 0.45
mat.surface_render_method = "BLENDED"
mat.use_backface_culling = False
mat.diffuse_color = (0.35, 0.9, 1.0, 0.45)

bm_src = bmesh.new()
bm_src.from_mesh(src.data)
bm_src.transform(src.matrix_world)
bm_src.faces.ensure_lookup_table()

# connected components once
comp_of = {}
comps = []
for f in bm_src.faces:
    if f.index in comp_of:
        continue
    cid = len(comps)
    stack, faces = [f], []
    comp_of[f.index] = cid
    while stack:
        cur = stack.pop()
        faces.append(cur.index)
        for e in cur.edges:
            for nf in e.link_faces:
                if nf.index not in comp_of:
                    comp_of[nf.index] = cid
                    stack.append(nf)
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    area = 0.0
    nrm = Vector()
    for i in faces:
        fc = bm_src.faces[i]
        a = fc.calc_area()
        area += a
        nrm += fc.normal * a
        for v in fc.verts:
            lo = Vector(map(min, lo, v.co))
            hi = Vector(map(max, hi, v.co))
    comps.append({"faces": faces, "center": (lo + hi) / 2, "area": area, "lo": lo, "hi": hi,
                  "normal": nrm.normalized() if nrm.length else nrm})


def find(center, area):
    c = Vector(center)
    best = min(comps, key=lambda k: (k["center"] - c).length + abs(k["area"] - area) * 2)
    if (best["center"] - c).length > 0.03 or abs(best["area"] - area) > max(0.004, area * 0.15):
        raise RuntimeError(f"no paint part near {center} with area {area}: closest {best['center']} {best['area']:.3f}")
    return best


report = []
for name, parts in TARGETS.items():
    picked = [k for k in comps if parts(k)] if callable(parts) else [find(c, a) for c, a in parts]
    if not picked:
        raise RuntimeError(f"{name}: no paint parts matched")
    face_ids = [i for k in picked for i in k["faces"]]
    report.append(f"{name}: {len(picked)} part(s) " + ", ".join(f"{k['area']:.3f}" for k in picked))
    bm = bmesh.new()
    vmap = {}
    uv_src = bm_src.loops.layers.uv.active
    uv_dst = bm.loops.layers.uv.new("UVMap")
    for i in face_ids:
        f = bm_src.faces[i]
        vs = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = bm.verts.new(v.co)
            vs.append(vmap[v.index])
        nf = bm.faces.new(vs)
        for l_new, l_old in zip(nf.loops, f.loops):
            l_new[uv_dst].uv = l_old[uv_src].uv
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    islands = 0
    seen_v = set()
    for v in bm.verts:
        if v in seen_v:
            continue
        islands += 1
        stack = [v]
        seen_v.add(v)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o not in seen_v:
                    seen_v.add(o)
                    stack.append(o)
    report.append(f"   welded {before - len(bm.verts)} verts -> {islands} island(s)")
    bm.normal_update()
    # push out along the averaged vertex normal (normals point away from the car on these panels)
    for v in bm.verts:
        v.co += v.normal * OFFSET
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    area3d = sum(p.area for p in me.polygons)
    dims = ob.dimensions
    report.append(f"   -> {len(me.polygons)} faces, {area3d:.3f} m2, bbox {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m")

bm_src.free()
bpy.ops.wm.save_mainfile()
print("\n".join(report))
