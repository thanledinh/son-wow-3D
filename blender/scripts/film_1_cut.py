"""Stage 1 of the PPF film: the plotter cuts the hood piece.

A 1.52 m PPF roll sits on the back tubes. The film is one long strip that follows a path curve: wound round the roll,
up onto the platen under the pinch rollers, over the nose, down the front and along the floor. Feeding = sliding the
strip along the path (Film_Feed empty, local X). A real plotter moves the film along Y and the carriage along X, so for
every outline point the feed puts that point under the blade and the carriage puts the blade over it. The cut line is
a thin ribbon revealed by a 'progress' attribute.
Re-runnable: rebuilds the Film_Rig collection each time.
"""
import math
import bpy
import bmesh
from mathutils import Matrix, Vector

R = 0.86                       # model frame -> real metres (machine root scale)
FILM_W = 1.52
ROLL_R = 0.0605                # outer radius of a 15 m PPF roll on a 3" core
TURNS = 7
CUT_START, CUT_END, FEED_END = 72, 252, 300   # frames (24 fps)
BLADE_X_MODEL, BLADE_Y_MODEL = 0.900, -0.038  # blade tip in the machine's model frame
PLATEN_Z = (1.10 + 0.07) * R + 0.0004
MACHINE_X, MACHINE_Y = -4.2, 0.6               # moved back from the car to make room for the cutting table
TABLE_TOP = 0.9985                             # just under the nose so the film slides out flat
TABLE_U0, TABLE_U1, TABLE_HALF_W = 0.17, 2.62, 0.86

scene = bpy.context.scene
root = bpy.data.objects["CNC_M1600"]
root.location = (MACHINE_X, MACHINE_Y, 0.0)

col = bpy.data.collections.get("Film_Rig")
if col is None:
    col = bpy.data.collections.new("Film_Rig")
    scene.collection.children.link(col)
for o in list(col.objects):
    data = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    try:
        if data is not None and data.users == 0:
            (bpy.data.curves if isinstance(data, bpy.types.Curve) else bpy.data.meshes).remove(data)
    except ReferenceError:      # shared datablock already freed
        pass


def empty(name, parent=None, matrix=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    col.objects.link(e)
    if parent:
        e.parent = parent
    if matrix is not None:
        e.matrix_basis = matrix
    return e


def mesh_obj(name, bm, mat, parent):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.parent = parent
    return ob


def mat_get(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree


# ------------------------------------------------------------------ materials
def film_material():
    m, nt = mat_get("PPF_FilmSheet")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.90, 0.94, 0.97, 1)
    b.inputs["Roughness"].default_value = 0.06
    b.inputs["Transmission Weight"].default_value = 0.55
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Alpha"].default_value = 0.88
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    m.surface_render_method = "DITHERED"
    m.use_backface_culling = False
    m.diffuse_color = (0.9, 0.94, 0.97, 0.88)
    return m


def roll_material():
    m, nt = mat_get("PPF_RollBody")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.86, 0.89, 0.9, 1)
    b.inputs["Roughness"].default_value = 0.15
    b.inputs["Coat Weight"].default_value = 1.0
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return m


def core_material():
    m, nt = mat_get("PPF_RollCore")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.45, 0.32, 0.18, 1)
    b.inputs["Roughness"].default_value = 0.8
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return m


def cutline_material():
    """Dark knife line, shown only where the outline 'progress' attribute is below the animated reveal value."""
    m, nt = mat_get("PPF_CutLine")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.05, 0.06, 0.07, 1)
    b.inputs["Roughness"].default_value = 0.3
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "progress"
    val = nt.nodes.new("ShaderNodeValue")
    val.name = "Reveal"
    val.outputs[0].default_value = 0.0
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    nt.links.new(attr.outputs["Fac"], lt.inputs[0])
    nt.links.new(val.outputs[0], lt.inputs[1])
    nt.links.new(lt.outputs[0], b.inputs["Alpha"])
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    m.surface_render_method = "DITHERED"
    return m


FILM = film_material()
ROLLM = roll_material()
CORE = core_material()
CUTM = cutline_material()

# ------------------------------------------------------------------ frames
frame = empty("M1600_Frame", matrix=Matrix.Translation((MACHINE_X, MACHINE_Y, 0.0)) @ Matrix.Rotation(math.pi / 2, 4, "Z"))
# path plane: curve local (u, w, k) -> machine (x = -k, y = -u, z = w); u grows towards the machine front
PATH_M = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
pathf = empty("Film_PathFrame", frame, PATH_M)

# ------------------------------------------------------------------ path (u = -y_machine, w = z), real metres
tube_y = (0.285 * R, 0.410 * R)
tube_r, tube_z = 0.015 * R, 0.942 * R
yc = sum(tube_y) / 2
half = (tube_y[1] - tube_y[0]) / 2
zc = tube_z + math.sqrt((ROLL_R + tube_r) ** 2 - half ** 2)
C = Vector((-yc, zc))                          # roll centre in (u, w)
P1 = Vector((-0.090, PLATEN_Z))                # back edge of the platen
D = (P1 - C).length
phi = math.atan2(P1.y - C.y, P1.x - C.x)
th_T = phi + math.acos(ROLL_R / D)             # upper tangent point (film leaves the top-back of the roll)

pts = []
n_sp = int(TURNS * 90)
for k in range(n_sp + 1):                      # spiral: from deep inside the roll out to the tangent point
    th = th_T + 2 * math.pi * TURNS * (1 - k / n_sp)
    r = ROLL_R - 0.0007 * (th - th_T) / (2 * math.pi)
    pts.append(C + Vector((math.cos(th), math.sin(th))) * r)
T = pts[-1]
n_line = max(2, int((P1 - T).length / 0.01))
pts += [T.lerp(P1, k / n_line) for k in range(1, n_line + 1)]


def catmull(P, step=0.008):
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
        n = max(2, int((p2 - p1).length / step))
        for k in range(1, n + 1):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return out


# over the platen, off the nose and straight out along the cutting table
FILM_ON_TABLE = TABLE_TOP + 0.0006
TAIL = [P1, Vector((0.0697, PLATEN_Z)), Vector((0.1000, PLATEN_Z)), Vector((0.135, PLATEN_Z - 0.0025)),
        Vector((0.175, FILM_ON_TABLE + 0.0015)), Vector((0.230, FILM_ON_TABLE)), Vector((0.600, FILM_ON_TABLE)),
        Vector((1.400, FILM_ON_TABLE)), Vector((2.300, FILM_ON_TABLE)), Vector((TABLE_U1 + 0.6, FILM_ON_TABLE))]
pts += catmull(TAIL)

S = [0.0]
for i in range(1, len(pts)):
    S.append(S[-1] + (pts[i] - pts[i - 1]).length)
TOTAL = S[-1]


def s_at_u(u_target, start=0):
    for i in range(max(1, start), len(pts)):
        if pts[i - 1].x <= u_target <= pts[i].x and pts[i - 1].y > 0.9:
            t = (u_target - pts[i - 1].x) / (pts[i].x - pts[i - 1].x)
            return S[i - 1] + t * (S[i] - S[i - 1])
    raise RuntimeError(f"u {u_target} not on the platen run")


s_T = S[n_sp]
s_blade = s_at_u(-BLADE_Y_MODEL * R, n_sp)
s_nose = s_at_u(0.135, n_sp)

cu = bpy.data.curves.new("Film_Path", "CURVE")
cu.dimensions = "2D"
cu.fill_mode = "NONE"
cu.use_path = True
cu.use_stretch = False
sp = cu.splines.new("POLY")
sp.points.add(len(pts) - 1)
for p_, q in zip(sp.points, pts):
    p_.co = (q.x, q.y, 0.0, 1.0)
# ------------------------------------------------------------------ cutting table in front of the plotter (machine-local, real m)
def table_top_material():
    m, nt = mat_get("Table_CutMat")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 0.55
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    lines = None
    for axis in ("X", "Y"):
        d = nt.nodes.new("ShaderNodeMath")
        d.operation = "DIVIDE"
        d.inputs[1].default_value = 0.05
        fr = nt.nodes.new("ShaderNodeMath")
        fr.operation = "FRACT"
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = 0.035
        nt.links.new(sep.outputs[axis], d.inputs[0])
        nt.links.new(d.outputs[0], fr.inputs[0])
        nt.links.new(fr.outputs[0], lt.inputs[0])
        if lines is None:
            lines = lt
        else:
            mx = nt.nodes.new("ShaderNodeMath")
            mx.operation = "MAXIMUM"
            nt.links.new(lines.outputs[0], mx.inputs[0])
            nt.links.new(lt.outputs[0], mx.inputs[1])
            lines = mx
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.04, 0.042, 1)
    ramp.color_ramp.elements[1].color = (0.11, 0.12, 0.125, 1)
    nt.links.new(lines.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return m


def tbox(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
                          @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    ob = mesh_obj(name, bm, mat, frame)
    if bevel:
        md = ob.modifiers.new("Bevel", "BEVEL")
        md.width = bevel
        md.segments = 2
    return ob


TOPM = table_top_material()
ALU = bpy.data.materials.get("CNC_Alu")
LEG = bpy.data.materials.get("CNC_Stand")
ty0, ty1 = -TABLE_U1, -TABLE_U0                 # machine y range (the table runs out of the machine front)
tbox("CutTable_Top", -TABLE_HALF_W, TABLE_HALF_W, ty0, ty1, TABLE_TOP - 0.022, TABLE_TOP, TOPM)
tbox("CutTable_Edge", -TABLE_HALF_W - 0.012, TABLE_HALF_W + 0.012, ty0 - 0.012, ty1 + 0.012,
     TABLE_TOP - 0.055, TABLE_TOP - 0.020, ALU, bevel=0.003)
for i, ly in enumerate((ty0 + 0.08, (ty0 + ty1) / 2, ty1 - 0.08)):
    for j, lx in enumerate((-TABLE_HALF_W + 0.08, TABLE_HALF_W - 0.08)):
        tbox(f"CutTable_Leg_{i}{j}", lx - 0.025, lx + 0.025, ly - 0.025, ly + 0.025, 0.03, TABLE_TOP - 0.055, LEG, bevel=0.003)
        tbox(f"CutTable_Foot_{i}{j}", lx - 0.03, lx + 0.03, ly - 0.03, ly + 0.03, 0.0, 0.03, LEG, bevel=0.004)
for j, lx in enumerate((-TABLE_HALF_W + 0.08, TABLE_HALF_W - 0.08)):
    tbox(f"CutTable_Rail_{j}", lx - 0.015, lx + 0.015, ty0 + 0.08, ty1 - 0.08, 0.16, 0.20, LEG, bevel=0.002)
tbox("CutTable_Shelf", -TABLE_HALF_W + 0.065, TABLE_HALF_W - 0.065, ty0 + 0.065, ty1 - 0.065, 0.20, 0.215, LEG)

path = bpy.data.objects.new("Film_Path", cu)
col.objects.link(path)
path.parent = pathf
path.hide_render = True
path.hide_set(True)

# ------------------------------------------------------------------ the hood pattern in strip coordinates
flat = bpy.data.objects["PPF_Hood_Flat"].data
fx = [v.co.x for v in flat.vertices]
LEADER = 0.18                                  # film already hanging past the blade before cutting
x_front = s_blade + LEADER                     # strip front edge (local x) at feed 0
PIECE_FRONT = x_front - 0.10
off_x = PIECE_FRONT - max(fx)
piece_len = max(fx) - min(fx)
F_START = s_blade - PIECE_FRONT                # feed that brings the piece's front point under the blade
F_FINAL = s_nose + 0.08 - (PIECE_FRONT - piece_len)
F_MIN = min(0.0, F_START)
x_back = s_T - 0.02 - F_FINAL                  # stays wound on the roll even at full feed
assert x_back + F_MIN > 0.05, "spiral too short"

feed = empty("Film_Feed", pathf)


def strip_mesh():
    bm = bmesh.new()
    n = int((x_front - x_back) / 0.004)
    vs = []
    for k in range(n + 1):
        x = x_back + (x_front - x_back) * k / n
        vs.append((bm.verts.new((x, 0.0, -FILM_W / 2)), bm.verts.new((x, 0.0, FILM_W / 2))))
    for k in range(n):
        bm.faces.new((vs[k][0], vs[k + 1][0], vs[k + 1][1], vs[k][1]))
    return bm


def add_curve_mod(ob):
    md = ob.modifiers.new("FollowPath", "CURVE")
    md.object = path
    md.deform_axis = "POS_X"
    return md


strip = mesh_obj("Film_Strip", strip_mesh(), FILM, feed)

# hood piece (same topology as the flat pattern / the draped hood piece): local x along the strip, z across
bm = bmesh.new()
bm.from_mesh(flat)
for v in bm.verts:
    v.co = Vector((v.co.x + off_x, 0.0004, v.co.y))
piece = mesh_obj("Film_Piece", bm, FILM, feed)
add_curve_mod(piece)

# boolean cutter (enabled when the piece separates) — applied to the strip before the path deform
bm = bmesh.new()
bm.from_mesh(flat)
for v in bm.verts:
    v.co = Vector((v.co.x + off_x, 0.0, v.co.y))
cutter = mesh_obj("Film_Cutter", bm, None, feed)
sol = cutter.modifiers.new("Thick", "SOLIDIFY")
sol.thickness = 0.02
sol.offset = 0.0
cutter.display_type = "WIRE"
cutter.hide_render = True
cutter.hide_set(True)
bo = strip.modifiers.new("PieceHole", "BOOLEAN")
bo.object = cutter
bo.operation = "DIFFERENCE"
bo.solver = "EXACT"
bo.show_viewport = False
bo.show_render = False
add_curve_mod(strip)

# knife line: ribbon along the piece outline with a 0..1 'progress' attribute
bm = bmesh.new()
bm.from_mesh(flat)
bound = [e for e in bm.edges if e.is_boundary]
adj = {}
for e in bound:
    a, b = e.verts
    adj.setdefault(a, []).append(b)
    adj.setdefault(b, []).append(a)
start = max(adj, key=lambda v: v.co.x)         # begin at the piece's front-most point
loop = [start]
prev = None
cur = start
while True:
    nxt = [v for v in adj[cur] if v is not prev]
    if not nxt or nxt[0] is start:
        break
    prev, cur = cur, nxt[0]
    loop.append(cur)
outline = [Vector((v.co.x + off_x, v.co.y)) for v in loop]
bm.free()
outline.append(outline[0])
L = [0.0]
for i in range(1, len(outline)):
    L.append(L[-1] + (outline[i] - outline[i - 1]).length)
PERIM = L[-1]

bm = bmesh.new()
prog = bm.verts.layers.float.new("progress")
pairs = []
for i, p in enumerate(outline):
    a = outline[i - 1] if i > 0 else outline[-2]
    b = outline[i + 1] if i < len(outline) - 1 else outline[1]
    t = (b - a).normalized()
    nrm = Vector((-t.y, t.x)) * 0.0007
    v1 = bm.verts.new((p.x + nrm.x, 0.0007, p.y + nrm.y))
    v2 = bm.verts.new((p.x - nrm.x, 0.0007, p.y - nrm.y))
    v1[prog] = v2[prog] = L[i] / PERIM
    pairs.append((v1, v2))
for i in range(len(pairs) - 1):
    bm.faces.new((pairs[i][0], pairs[i + 1][0], pairs[i + 1][1], pairs[i][1]))
cutline = mesh_obj("Film_CutLine", bm, CUTM, feed)
me = cutline.data
src_attr = me.attributes.get("progress")
if src_attr is None or src_attr.domain != "POINT":
    raise RuntimeError("progress attribute missing")
add_curve_mod(cutline)

# ------------------------------------------------------------------ roll body + core
def cylinder_z(name, r, length, mat, center):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=r, radius2=r, depth=length,
                          matrix=Matrix.Translation((center.x, center.y, 0.0)))
    for f in bm.faces:
        f.smooth = len(f.verts) == 4
    return mesh_obj(name, bm, mat, pathf)


r_in = ROLL_R - 0.0007 * TURNS - 0.0008
cylinder_z("Film_RollBody", r_in, FILM_W, ROLLM, C)
core = cylinder_z("Film_RollCore", 0.040, FILM_W + 0.03, CORE, C)
core.data.transform(Matrix.Translation((-C.x, -C.y, 0)))
core.location = (C.x, C.y, 0)

# ------------------------------------------------------------------ carriage rig (model frame, under the machine root)
rig = bpy.data.objects.get("Carriage_Rig")
if rig is None:
    rig = bpy.data.objects.new("Carriage_Rig", None)
    bpy.data.collections["CNC_M1600"].objects.link(rig)
    rig.parent = root
    rig.empty_display_size = 0.05
bpy.context.view_layer.update()   # the rig must be evaluated before children keep their world matrices
for o in bpy.data.collections["CNC_M1600"].objects:
    if o.name.startswith("Carriage_") and o is not rig and o.parent is root:
        mw = o.matrix_world.copy()
        o.parent = rig
        o.matrix_world = mw

# ------------------------------------------------------------------ animation
for ob in (feed, rig, core):
    ob.animation_data_clear()
CUTM.node_tree.animation_data_clear()
reveal = CUTM.node_tree.nodes["Reveal"].outputs[0]


def key_feed(f, F):
    feed.location.x = F
    feed.keyframe_insert("location", index=0, frame=f)
    core.rotation_euler.z = -F / ROLL_R
    core.keyframe_insert("rotation_euler", index=2, frame=f)


def key_carriage(f, x_real):
    rig.location.x = x_real / R - BLADE_X_MODEL
    rig.keyframe_insert("location", index=0, frame=f)


def key_reveal(f, v):
    reveal.default_value = v
    reveal.keyframe_insert("default_value", frame=f)


def smooth(t):
    return t * t * (3 - 2 * t)


def outline_at(d):
    d = max(0.0, min(PERIM, d))
    for i in range(1, len(L)):
        if L[i] >= d:
            t = (d - L[i - 1]) / max(1e-9, L[i] - L[i - 1])
            return outline[i - 1].lerp(outline[i], t)
    return outline[-1]


# idle -> threading forward to the first cut point; carriage waits at its parking spot
key_feed(1, 0.0)
key_feed(CUT_START - 18, 0.0)
key_feed(CUT_START, F_START)
key_carriage(1, BLADE_X_MODEL * R)
key_carriage(CUT_START - 24, BLADE_X_MODEL * R)
p0 = outline_at(0.0)
key_carriage(CUT_START, -p0.y)
key_reveal(1, 0.0)
key_reveal(CUT_START, 0.0)
for f in range(CUT_START + 1, CUT_END + 1):
    t = smooth((f - CUT_START) / (CUT_END - CUT_START))
    p = outline_at(t * PERIM)
    key_feed(f, s_blade - p.x)
    key_carriage(f, -p.y)
    key_reveal(f, t + 0.002)
# carriage parks; film is pushed out so the whole piece hangs past the nose
key_carriage(CUT_END + 20, BLADE_X_MODEL * R)
key_feed(FEED_END, F_FINAL)
for fc in list(feed.animation_data.action.fcurves) if feed.animation_data and getattr(feed.animation_data.action, "fcurves", None) else []:
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"

scene.frame_start = 1
scene.frame_end = max(scene.frame_end, FEED_END + 24)
scene.render.fps = 24
scene.frame_set(1)
bpy.ops.wm.save_mainfile()
print(f"path {TOTAL:.2f} m, spiral {s_T:.2f} m, blade at s={s_blade:.3f}, nose s={s_nose:.3f}")
print(f"piece {piece_len:.3f} m, perimeter {PERIM:.2f} m; feed start {F_START:.3f} final {F_FINAL:.3f}; strip x {x_back:.2f}..{x_front:.2f}")
print(f"roll centre machine y={yc:.3f} z={zc:.3f}; carriage rig children: {len(rig.children)}")
