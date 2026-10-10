"""Stage 2: the cut piece separates, unfolds, flies onto the hood, splits into its 5 layers, merges, the release
liner peels off and the film settles onto the hood.

PPF_HoodFilm shares the hood piece's topology. Shape keys (relative to a flat Basis aligned with the hood from above):
  OnMachine  - exactly the piece as it hangs off the plotter at SEP (in the object's SEP frame)
  OnHood     - the draped hood shape
Layer objects (5) carry 'Spread' keys (offset along the hood normals); the liner also gets 'Peel_k' curl keys.
Re-runnable.
"""
import math
import bpy
import bmesh
from mathutils import Matrix, Vector, Quaternion

SEP, LIFT_END, FLY_END, DRAPE_END = 312, 340, 396, 414
SPLIT_START, SPLIT_END, MERGE_START, MERGE_END = 420, 452, 500, 524
PEEL_START, PEEL_END, LINER_GONE = 530, 572, 600
APPLY_START, APPLY_END = 572, 604
HOVER = 0.34
LAYERS = [  # name, label, colour, alpha, spread (m above the liner)
    ("L1_TopCoat", "Lớp phủ tự phục hồi", (0.92, 0.96, 0.98), 0.35, 0.40),
    ("L2_Gloss", "Lớp tăng độ bóng", (0.56, 0.89, 0.93), 0.50, 0.30),
    ("L3_TPU", "Màng nền TPU", (0.05, 0.54, 0.58), 0.88, 0.20),
    ("L4_Adhesive", "Lớp keo kết dính", (0.35, 0.05, 0.14), 0.85, 0.10),
    ("L5_Liner", "Màng lót bảo vệ", (0.44, 0.52, 0.60), 0.92, 0.00),
]
N_PEEL = 10
CURL_R = 0.035

scene = bpy.context.scene
col = bpy.data.collections.get("Film_Anim")
if col is None:
    col = bpy.data.collections.new("Film_Anim")
    scene.collection.children.link(col)
for o in list(col.objects):
    data = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if data is not None and data.users == 0 and data.name in bpy.data.meshes:
        bpy.data.meshes.remove(data)

hood = bpy.data.objects["PPF_Hood"]
flat = bpy.data.objects["PPF_Hood_Flat"]
piece = bpy.data.objects["Film_Piece"]
strip = bpy.data.objects["Film_Strip"]

# hood mesh is centred on its centroid (stage 3); its rest placement is stored in 'burst_c'
_rest = Matrix.Translation(Vector(hood["burst_c"])) if "burst_c" in hood else hood.matrix_world
H = [_rest @ v.co for v in hood.data.vertices]
Fp = [v.co.to_2d() for v in flat.data.vertices]
n = len(H)
assert n == len(Fp) == len(piece.data.vertices), "topology mismatch"

# ------------------------------------------------------------------ flat pattern aligned to the hood seen from above (2D Kabsch)
hc = sum((h.to_2d() for h in H), Vector((0, 0))) / n
fc = sum(Fp, Vector((0, 0))) / n
sxx = sxy = syx = syy = 0.0
for f, h in zip(Fp, H):
    a = f - fc
    b = h.to_2d() - hc
    sxx += a.x * b.x
    sxy += a.x * b.y
    syx += a.y * b.x
    syy += a.y * b.y
ang = math.atan2(sxy - syx, sxx + syy)
Rm = Matrix.Rotation(ang, 2)
hz = sum(h.z for h in H) / n
ORIGIN = Vector((hc.x, hc.y, hz))
BASIS = [Vector(((Rm @ (f - fc)).x, (Rm @ (f - fc)).y, 0.0)) for f in Fp]
ONHOOD = [h - ORIGIN for h in H]

# ------------------------------------------------------------------ the piece as it lies on the table at SEP
# (hidden objects are not evaluated, so drop last run's visibility keys before reading the deformed mesh)
piece.animation_data_clear()
piece.hide_viewport = piece.hide_render = False
scene.frame_set(SEP)
dg = bpy.context.evaluated_depsgraph_get()
ev = piece.evaluated_get(dg)
W = [ev.matrix_world @ v.co for v in ev.data.vertices]
cd = sum(W, Vector()) / n
# The piece lies flat on the cutting table at SEP: find the rigid transform that puts the flat BASIS exactly there
# (3D Kabsch), so lifting it off the table needs no deformation at all.
import numpy as np
Pm = np.array([tuple(p) for p in BASIS])
Qm = np.array([tuple(q) for q in W])
pc, qc = Pm.mean(0), Qm.mean(0)
Hm = (Pm - pc).T @ (Qm - qc)
U, _, Vt = np.linalg.svd(Hm)
dsign = np.sign(np.linalg.det(Vt.T @ U.T))
Rk = Vt.T @ np.diag([1, 1, dsign]) @ U.T
R3 = Matrix(Rk.tolist()).to_4x4()
M_SEP = Matrix.Translation(Vector(qc)) @ R3 @ Matrix.Translation(-Vector(pc))
M_LIFT = Matrix.Translation(Vector(qc) + Vector((0.35, 0.15, 0.55))) @ Matrix.Rotation(math.radians(-12), 4, "Y") \
    @ R3 @ Matrix.Translation(-Vector(pc))
M_HOVER = Matrix.Translation(ORIGIN + Vector((0, 0, HOVER)))
inv = M_SEP.inverted()
ONMACH = [inv @ w for w in W]


def new_mesh_obj(name, coords, mat=None):
    me = hood.data.copy()
    me.name = name
    for v, c in zip(me.vertices, coords):
        v.co = c
    me.materials.clear()
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def add_key(ob, name, coords):
    if ob.data.shape_keys is None:
        ob.shape_key_add(name="Basis", from_mix=False)
    k = ob.shape_key_add(name=name, from_mix=False)
    for d, c in zip(k.data, coords):
        d.co = c
    return k


def film_mat(name, colour, alpha, rough=0.08, extra=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Alpha"].default_value = alpha
    b.inputs["Emission Color"].default_value = (*colour, 1)
    b.inputs["Emission Strength"].default_value = 0.15
    if extra:
        extra(nt, b)
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    m.surface_render_method = "DITHERED"
    m.use_backface_culling = False
    m.diffuse_color = (*colour, alpha)
    return m


def iridescent(nt, b):
    if "Thin Film Thickness" in b.inputs:
        b.inputs["Thin Film Thickness"].default_value = 420.0
        b.inputs["Thin Film IOR"].default_value = 1.4


def hexes(nt, b):
    """Honeycomb glow on the TPU core (the brand's hex motif)."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 26.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.5, 0.95, 1.0, 1)
    ramp.color_ramp.elements[1].position = 0.06
    ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1)
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.2


FILM = bpy.data.materials["PPF_FilmSheet"]

# ------------------------------------------------------------------ the flying hood film
film = new_mesh_obj("PPF_HoodFilm", BASIS, FILM)
k_mach = add_key(film, "OnMachine", ONMACH)
k_hood = add_key(film, "OnHood", ONHOOD)
film.rotation_mode = "QUATERNION"


def key_matrix(ob, f, M):
    loc, rot, _ = M.decompose()
    ob.location = loc
    ob.rotation_quaternion = rot
    ob.keyframe_insert("location", frame=f)
    ob.keyframe_insert("rotation_quaternion", frame=f)


def key_val(k, f, v):
    k.value = v
    k.keyframe_insert("value", frame=f)


def key_vis(ob, f, visible):
    ob.hide_viewport = not visible
    ob.hide_render = not visible
    ob.keyframe_insert("hide_viewport", frame=f)
    ob.keyframe_insert("hide_render", frame=f)


key_vis(film, 1, False)
key_vis(film, SEP, True)
key_vis(film, SPLIT_START, False)
key_vis(film, MERGE_END, True)
key_matrix(film, SEP, M_SEP)
key_matrix(film, LIFT_END, M_LIFT)
mid = Matrix.Translation((M_LIFT.translation + M_HOVER.translation) / 2 + Vector((0, 0, 0.55))) \
    @ Quaternion().slerp(M_LIFT.to_quaternion(), 0.35).to_matrix().to_4x4()
key_matrix(film, (LIFT_END + FLY_END) // 2, mid)
key_matrix(film, FLY_END, M_HOVER)
key_matrix(film, APPLY_START, M_HOVER)
key_matrix(film, APPLY_END, Matrix.Translation(ORIGIN))
key_val(k_mach, SEP, 1.0)
key_val(k_mach, LIFT_END, 0.0)
key_val(k_hood, 1, 0.0)
key_val(k_hood, FLY_END, 0.0)
key_val(k_hood, DRAPE_END, 1.0)

# hand-off: the machine piece disappears and the waste sheet gets its hole at SEP
for ob in (piece,):
    ob.animation_data_clear()
    key_vis(ob, 1, True)
    key_vis(ob, SEP, False)
bo = strip.modifiers["PieceHole"]
for attr in ("show_viewport", "show_render"):
    setattr(bo, attr, False)
    bo.keyframe_insert(attr, frame=1)
    setattr(bo, attr, True)
    bo.keyframe_insert(attr, frame=SEP)

# ------------------------------------------------------------------ the five layers above the hood
me_tmp = hood.data.copy()
for v, c in zip(me_tmp.vertices, ONHOOD):
    v.co = c
me_tmp.update()
NRM = [v.normal.copy() for v in me_tmp.vertices]
if sum(nv.z for nv in NRM) < 0:
    NRM = [-nv for nv in NRM]
bpy.data.meshes.remove(me_tmp)

lay_root = bpy.data.objects.new("Layers_Root", None)
col.objects.link(lay_root)
lay_root.matrix_world = M_HOVER
lay_root.empty_display_size = 0.2
layer_objs = []
for name, label, colour, alpha, d in LAYERS:
    extra = iridescent if name == "L1_TopCoat" else hexes if name == "L3_TPU" else None
    m = film_mat("PPF_" + name, colour, alpha, extra=extra)
    ob = new_mesh_obj("Layer_" + name, ONHOOD, m)
    ob.parent = lay_root
    k = add_key(ob, "Spread", [c + nv * d for c, nv in zip(ONHOOD, NRM)])
    key_val(k, SPLIT_START, 0.0)
    key_val(k, SPLIT_END, 1.0)
    key_val(k, MERGE_START, 1.0)
    key_val(k, MERGE_END, 0.0)
    key_vis(ob, 1, False)
    key_vis(ob, SPLIT_START, True)
    key_vis(ob, MERGE_END, name == "L5_Liner")
    layer_objs.append(ob)

# ------------------------------------------------------------------ liner peel: rolls back from the hood's front edge
liner = layer_objs[-1]
liner.data.materials.clear()
liner.data.materials.append(bpy.data.materials["PPF_L5_Liner"])
LINER_BASE = [c - nv * 0.003 for c, nv in zip(ONHOOD, NRM)]   # sits just under the merged film
for v, c in zip(liner.data.vertices, LINER_BASE):
    v.co = c
liner.data.shape_keys.key_blocks["Basis"].data.foreach_set("co", [x for c in LINER_BASE for x in c])
liner.data.shape_keys.key_blocks["Spread"].data.foreach_set("co", [x for c in LINER_BASE for x in c])
ys = [c.y for c in LINER_BASE]
y_front, y_back = max(ys), min(ys)
# centre-line height profile along Y, so the curl rides on the hood's slope (the cross crown is kept per vertex)
cx_mid = sum(c.x for c in LINER_BASE) / n
bins = {}
for c in LINER_BASE:
    if abs(c.x - cx_mid) < 0.3:
        bins.setdefault(round(c.y / 0.02), []).append(c.z)
prof = sorted((k * 0.02, sum(v) / len(v)) for k, v in bins.items())


def zl(y):
    if y <= prof[0][0]:
        return prof[0][1]
    for (y0, z0), (y1, z1) in zip(prof, prof[1:]):
        if y0 <= y <= y1:
            return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return prof[-1][1]


for kidx in range(1, N_PEEL + 1):
    yf = y_front - (y_front - y_back + 0.25) * kidx / N_PEEL
    pts = []
    for c in LINER_BASE:
        a = c.y - yf
        if a <= 0:
            pts.append(c.copy())
            continue
        th = a / CURL_R
        if th <= math.pi:
            dy, dz = CURL_R * math.sin(th), CURL_R * (1 - math.cos(th))
        else:
            dy, dz = -(a - math.pi * CURL_R), 2 * CURL_R
        z_here = c.z + (zl(min(yf, y_front)) - zl(c.y))
        pts.append(Vector((c.x, yf + dy, z_here + dz)))
    add_key(liner, f"Peel_{kidx}", pts)
pk = [liner.data.shape_keys.key_blocks[f"Peel_{i}"] for i in range(1, N_PEEL + 1)]
for i, k in enumerate(pk):
    f0 = PEEL_START + (PEEL_END - PEEL_START) * i / N_PEEL
    f1 = PEEL_START + (PEEL_END - PEEL_START) * (i + 1) / N_PEEL
    key_val(k, 1, 0.0)
    key_val(k, int(f0), 0.0)
    key_val(k, int(f1), 1.0)
    if i + 1 < N_PEEL:
        key_val(k, int(f1 + (PEEL_END - PEEL_START) / N_PEEL), 0.0)
liner.rotation_mode = "XYZ"
liner.keyframe_insert("location", frame=PEEL_END)
liner.location = (0.6, 1.4, 0.9)
liner.rotation_euler = (0.9, 0.3, 0.4)
liner.keyframe_insert("location", frame=LINER_GONE)
liner.keyframe_insert("rotation_euler", frame=LINER_GONE)
liner.location = (0, 0, 0)
liner.rotation_euler = (0, 0, 0)
liner.keyframe_insert("rotation_euler", frame=PEEL_END)
key_vis(liner, LINER_GONE, False)

# 3D labels beside the spread layers (face the camera later via a Track To constraint)
for (name, label, colour, alpha, d), ob in zip(LAYERS, layer_objs):
    cu = bpy.data.curves.new("Label_" + name, "FONT")
    cu.body = label
    cu.size = 0.075
    cu.align_y = "CENTER"
    fp = r"C:\Windows\Fonts\arialbd.ttf"
    cu.font = bpy.data.fonts.load(fp, check_existing=True)
    lm = film_mat("PPF_Label", (1.0, 0.72, 0.16), 1.0)
    cu.materials.append(lm)
    t = bpy.data.objects.new("Label_" + name, cu)
    col.objects.link(t)
    t.parent = lay_root
    t.location = (1.05, 0.05, d + 0.02)
    t.rotation_euler = (math.radians(70), 0, math.radians(-90))
    key_vis(t, 1, False)
    key_vis(t, SPLIT_END - 6, True)
    key_vis(t, MERGE_START + 4, False)

# the original static hood piece only appears once the film is applied
for ob in (hood,):              # visibility keys only — its burst keys (stage 3) must survive
    key_vis(ob, 1, False)
    key_vis(ob, APPLY_END, True)
key_vis(film, APPLY_END + 1, False)

scene.frame_end = max(scene.frame_end, LINER_GONE + 48)
scene.frame_set(1)
bpy.ops.wm.save_mainfile()
print(f"hood film verts {n}; kabsch angle {math.degrees(ang):.1f} deg; origin {tuple(round(v, 3) for v in ORIGIN)}")
print(f"piece centroid at SEP {tuple(round(v, 3) for v in cd)}; hood y {y_back:.2f}..{y_front:.2f}")
