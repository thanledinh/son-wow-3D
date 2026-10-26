"""blender -b --factory-startup --python make_kit_911.py -- <out .blend>

The Porsche 911 trial car's own PPF kit (?car=porsche911), cut from its paint the way make_ppf_pieces.py and
film_3_burst.py cut the Urus's: each piece is one UV island of the paint (the car's own panel), copied, welded and
pushed out along its normals so it sits on the paint. Saves a .blend with PPF_Hood + PPF_Panel_* (mesh centred on
its centroid, burst_c / burst_dir set), ready for export_patterns_web.py.
The glTF is placed exactly where the page puts it (src/car.js loadTrial: turned 180 deg about up, scaled to 4.52 m,
centred, wheels on the floor), so after the export's Y-up turn the pieces are in the page's car space.
"""
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

GLTF = os.path.join(os.path.dirname(__file__), "..", "..", "public", "models", "porsche911", "scene.gltf")
out_path = sys.argv[sys.argv.index("--") + 1]

OFFSET = 0.002  # 2 mm above the paint so it never z-fights (real film is ~0.2 mm)
WELD = 0.002    # the glTF splits each panel at its UV and normal seams; touching edges get welded back
LIFT = 0.25     # side pieces fly out level plus this much up, like the Urus's (about 24% up)

# node "Sketchfab_model"'s frame (Sketchfab world, Z up) -> the page's world (metres, glTF axes), read off the
# running page: page = 0.0461664 * (-x, z, y) + (2.72848, 0.71413, 0.43627)
PAGE = Matrix((
    (-0.04616643063580897, -5.653757150620176e-18, 1.2553862728515278e-33, 2.7284753580817394),
    (0, 1.0251006851327065e-17, 0.04616643063580897, 0.7141292339977733),
    (-5.653757150620176e-18, 0.04616643063580897, -1.0251006851327065e-17, 0.436266932154717),
    (0, 0, 0, 1),
))
# glTF axes -> Blender axes: (x, y, z) -> (x, -z, y)
GL2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def page(v):
    """Blender -> page (glTF axes): x right, y up, z rear"""
    return Vector((v.x, v.z, -v.y))


# Each piece is the paint island whose bounding-box centre (page coords) and area (m2) these are; left = page -x.
# Left out: the cowl under the windscreen (faces in), mirrors and door handles (own islands), the engine lid's second
# 0.313 island (the spoiler's underside: faces down, 7 mm under the top skin) and tiny trims.
TARGETS = {
    "PPF_Hood":              ((0.00, 0.73, -1.45), 1.346),
    "PPF_Panel_FrontBumper": ((0.00, 0.37, -1.90), 0.753),
    "PPF_Panel_Fender_L":    ((-0.65, 0.56, -1.35), 0.544),
    "PPF_Panel_Fender_R":    ((0.65, 0.56, -1.35), 0.544),
    "PPF_Panel_Door_L":      ((-0.81, 0.57, -0.08), 0.793),
    "PPF_Panel_Door_R":      ((0.81, 0.57, -0.08), 0.793),
    "PPF_Panel_Quarter_L":   ((-0.79, 0.55, 0.50), 0.595),    # rear quarter with its sill
    "PPF_Panel_Quarter_R":   ((0.79, 0.55, 0.50), 0.595),
    "PPF_Panel_RearBumper":  ((0.00, 0.48, 1.79), 1.166),
    "PPF_Panel_RearDeck":    ((0.00, 0.94, 1.35), 0.442),     # round the engine grille
    "PPF_Panel_EngineLid":   ((0.00, 0.85, 1.98), 0.417),     # the spoiler's top skin behind the grille
    "PPF_Panel_Windscreen":  ((0.00, 1.04, -0.37), 0.149),    # A-pillars + header
}

# ------------------------------------------------------------------ the car, where the page puts it
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(GLTF), merge_vertices=False)
# the importer turns every node into Blender axes, so the page's mapping is turned the same way
bpy.data.objects["Sketchfab_model"].matrix_world = GL2B @ PAGE @ GL2B.inverted()
bpy.context.view_layer.update()
paint = [o for o in bpy.data.objects
         if o.type == "MESH" and any(m and m.name == "PAINT_COLOR_4" for m in o.data.materials)]

col = bpy.data.collections.new("PPF_Pieces")
bpy.context.scene.collection.children.link(col)

mat = bpy.data.materials.new("PPF_Preview")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.35, 0.9, 1.0, 1.0)
bsdf.inputs["Roughness"].default_value = 0.08
bsdf.inputs["Alpha"].default_value = 0.45
mat.surface_render_method = "BLENDED"
mat.use_backface_culling = False
mat.diffuse_color = (0.35, 0.9, 1.0, 0.45)

# every paint island (connected component; the unmerged import splits them at UV seams), in world space
islands, meshes = [], []
lo = Vector((1e9,) * 3)
hi = -lo
for o in paint:
    bm = bmesh.new()
    meshes.append(bm)
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    seen = set()
    for f in bm.faces:
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
        pts = [page(v.co) for x in faces for v in x.verts]
        ilo = Vector([min(p[i] for p in pts) for i in range(3)])
        ihi = Vector([max(p[i] for p in pts) for i in range(3)])
        lo = Vector(map(min, lo, ilo))
        hi = Vector(map(max, hi, ihi))
        islands.append({"bm": bm, "faces": faces, "center": (ilo + ihi) / 2,
                        "area": sum(x.calc_area() for x in faces)})
report = [f"paint box (page): x {lo.x:+.3f}..{hi.x:+.3f}  y {lo.y:.3f}..{hi.y:.3f}  z {lo.z:+.3f}..{hi.z:+.3f}"]


def find(center, area):
    c = Vector(center)
    best = min(islands, key=lambda k: (k["center"] - c).length + abs(k["area"] - area) * 2)
    if (best["center"] - c).length > 0.03 or abs(best["area"] - area) > max(0.004, area * 0.15):
        raise RuntimeError(f"no paint island near {center} with area {area}: closest {best['center']} {best['area']:.3f}")
    return best


def outward(p):
    """roughly away from the car: the normal of an ellipsoid round the body (Blender coords)"""
    return Vector((p.x / 1.0 ** 2, p.y / 2.3 ** 2, (p.z - 0.55) / 0.7 ** 2)).normalized()


for name, (center, area) in TARGETS.items():
    k = find(center, area)
    bm = bmesh.new()
    vmap = {}
    uv_src = k["bm"].loops.layers.uv.active
    uv_dst = bm.loops.layers.uv.new("UVMap")
    for f in k["faces"]:
        vs = []
        for v in f.verts:
            if v.index not in vmap:
                vmap[v.index] = bm.verts.new(v.co)
            vs.append(vmap[v.index])
        try:
            nf = bm.faces.new(vs)
        except ValueError:
            continue
        for l_new, l_old in zip(nf.loops, f.loops):
            l_new[uv_dst].uv = l_old[uv_src].uv
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bm.normal_update()
    # film goes on the outside: the panel's faces must point away from the car
    agree = sum(f.calc_area() * (1 if f.normal.dot(outward(f.calc_center_median())) > 0 else -1) for f in bm.faces)
    flipped = agree < 0
    if flipped:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
    # out along the vertex normal, a little further at creases so the film stays 2 mm off both faces (capped)
    push = [v.normal * OFFSET * min(v.calc_shell_factor(), 1.5) for v in bm.verts]
    for v, d in zip(bm.verts, push):
        v.co += d
    # rest centre = the pushed-out piece's centroid; the mesh is centred on it (like the Urus pieces)
    a3 = sum(f.calc_area() for f in bm.faces)
    c = sum((f.calc_center_median() * f.calc_area() for f in bm.faces), Vector()) / a3
    n = sum((f.normal * f.calc_area() for f in bm.faces), Vector()).normalized()
    bmesh.ops.translate(bm, vec=-c, verts=bm.verts)
    # fly-out direction: side, nose and tail pieces go out level plus a lift; pieces on top go along their normal
    if abs(n.z) < 0.6:
        d = (Vector((n.x, n.y, 0)).normalized() + Vector((0, 0, LIFT))).normalized()
    else:
        d = n
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.location = c
    ob["burst_c"] = list(c)
    ob["burst_dir"] = list(d)
    pc, pd = page(c), page(d)
    report.append(f"{name}: island {k['area']:.3f} m2, welded {before - len(me.vertices)} verts"
                  f"{', flipped' if flipped else ''} -> {len(me.polygons)} faces, {a3:.3f} m2;"
                  f" rest ({pc.x:+.2f}, {pc.y:.2f}, {pc.z:+.2f}) dir ({pd.x:+.2f}, {pd.y:+.2f}, {pd.z:+.2f})")

for bm in meshes:
    bm.free()
os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_path))
print("\n".join(report))
