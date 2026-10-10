"""Build the ZAPPA M-1600 cutting plotter next to the Urus, from the shop's photos/videos.

Machine coordinates (metres): X along the machine (+X = right end with the control panel,
seen from the operator), -Y = front (operator side, ruler), +Y = back (film roll rods), Z up
from the floor. Every part is parented to the empty 'CNC_M1600', so moving that empty moves
the whole machine. Re-running the script rebuilds the machine from scratch.
"""
import math
import os
import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT_LOC = (-4.2, 0.6, 0.0)       # beside the car's left side, set back to leave room for the cutting table
ROOT_ROT_Z = math.radians(90)     # machine front (-Y) faces the car (+X world)

PINCH_X = (-0.80, -0.50, -0.22, 0.10, 0.40, 0.75)
CARRIAGE_X = 0.55

# ------------------------------------------------------------------ collection + root
col = bpy.data.collections.get("CNC_M1600")
if col is None:
    col = bpy.data.collections.new("CNC_M1600")
    bpy.context.scene.collection.children.link(col)
for o in list(col.objects):
    data = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if data is not None and data.users == 0:
        (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.curves).remove(data)

root = bpy.data.objects.new("CNC_M1600", None)
root.empty_display_type = "PLAIN_AXES"
root.empty_display_size = 0.3
col.objects.link(root)
root.location = ROOT_LOC
root.rotation_euler = (0.0, 0.0, ROOT_ROT_Z)


# ------------------------------------------------------------------ materials
def principled(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = emit_strength
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    m.diffuse_color = (*color, 1.0)
    m.metallic = metallic
    m.roughness = rough
    return m, nt, b


def ramp_material(name, axis, period, colors, profile="SAW", metallic=0.0, rough=0.5):
    """Stripes along one object axis: wave texture -> constant colour ramp.
    colors = [(position, rgb), ...]. Blender's wave bands have a period of 2*pi/20 per unit."""
    m, nt, b = principled(name, colors[0][1], metallic=metallic, rough=rough)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = axis
    wave.wave_profile = profile
    wave.inputs["Scale"].default_value = (2 * math.pi / 20) / period
    wave.inputs["Distortion"].default_value = 0.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    while len(els) < len(colors):
        els.new(0.5)
    for el, (pos, rgb) in zip(els, colors):
        el.position = pos
        el.color = (*rgb, 1.0)
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


def steel_holes(name, pitch_x, pitch_y, radius_frac):
    """Perforated stainless platen: a regular grid of dark holes (vacuum holes)."""
    steel = (0.72, 0.73, 0.74)
    m, nt, b = principled(name, steel, metallic=0.9, rough=0.32)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = (1 / pitch_x, 1 / pitch_y, 0.0)
    fr = nt.nodes.new("ShaderNodeVectorMath")
    fr.operation = "FRACTION"
    sub = nt.nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (0.5, 0.5, 0.0)
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = radius_frac
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = (*steel, 1.0)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (0.01, 0.01, 0.01, 1.0)
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(tc.outputs["Object"], mul.inputs[0])
    nt.links.new(mul.outputs["Vector"], fr.inputs[0])
    nt.links.new(fr.outputs["Vector"], sub.inputs[0])
    nt.links.new(sub.outputs["Vector"], ln.inputs[0])
    nt.links.new(ln.outputs["Value"], lt.inputs[0])
    nt.links.new(lt.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(lt.outputs["Value"], inv.inputs[1])
    nt.links.new(inv.outputs["Value"], b.inputs["Metallic"])
    return m


def ribbed(name):
    """Black anodised extrusion with fine horizontal ribs (front/back apron of the body)."""
    m, nt, b = principled(name, (0.028, 0.028, 0.03), metallic=0.45, rough=0.42)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = (2 * math.pi / 20) / 0.004
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.002
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


BLACK = principled("CNC_BlackPowder", (0.016, 0.016, 0.018), rough=0.55)[0]
SATIN = principled("CNC_BlackSatin", (0.022, 0.022, 0.024), rough=0.52)[0]
GLOSS = principled("CNC_BlackGloss", (0.01, 0.01, 0.012), rough=0.12)[0]
RIB = ribbed("CNC_RibbedBlack")
STEEL = principled("CNC_Steel", (0.6, 0.61, 0.62), metallic=1.0, rough=0.3)[0]
PLATEN = steel_holes("CNC_PlatenHoles", 0.022, 0.018, 0.13)
ALU = principled("CNC_Alu", (0.8, 0.81, 0.82), metallic=1.0, rough=0.28)[0]
RUBBER = principled("CNC_Rubber", (0.012, 0.012, 0.012), rough=0.85)[0]
CREAM = principled("CNC_Cream", (0.8, 0.77, 0.64), rough=0.5)[0]
WHITE = principled("CNC_White", (0.86, 0.86, 0.84), rough=0.45)[0]
LED = principled("CNC_LED", (1, 1, 1), rough=0.3, emit=(1, 1, 1), emit_strength=6.0)[0]
LCD = principled("CNC_LCD", (0.05, 0.12, 0.7), rough=0.15, emit=(0.12, 0.28, 1.0), emit_strength=1.2)[0]
YELLOW = principled("CNC_LogoYellow", (1.0, 0.6, 0.02), rough=0.35)[0]
BLUE = principled("CNC_BadgeBlue", (0.03, 0.12, 0.6), metallic=0.5, rough=0.3)[0]
BRASS = principled("CNC_Brass", (0.85, 0.6, 0.25), metallic=1.0, rough=0.35)[0]
RULER = ramp_material("CNC_Ruler", "X", 0.01, [(0.0, (0.9, 0.9, 0.88)), (0.88, (0.02, 0.02, 0.02))])
STRIPES = ramp_material("CNC_Stripes", "X", 0.0225, [(0.0, (0.95, 0.75, 0.05)), (0.5, (0.02, 0.02, 0.02))])


# ------------------------------------------------------------------ geometry helpers
def finish(name, bm, mat, bevel=0.0, smooth_angle=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.parent = root
    if smooth_angle is not None or bevel > 0:
        for p in me.polygons:
            p.use_smooth = True
    if smooth_angle is not None:
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    if bevel > 0:
        md = ob.modifiers.new("Bevel", "BEVEL")
        md.width = bevel
        md.segments = 3
        md.limit_method = "ANGLE"
        md.harden_normals = True
    return ob


def add_cube(bm, x0, x1, y0, y1, z0, z1):
    s = (x1 - x0, y1 - y0, z1 - z0)
    c = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*s, 1.0)))


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    bm = bmesh.new()
    add_cube(bm, x0, x1, y0, y1, z0, z1)
    return finish(name, bm, mat, bevel=bevel)


def boxes(name, extents, mat, bevel=0.0):
    bm = bmesh.new()
    for e in extents:
        add_cube(bm, *e)
    return finish(name, bm, mat, bevel=bevel)


def tilted_box(name, size, center, rot_x_deg, mat, bevel=0.0):
    bm = bmesh.new()
    m = Matrix.Translation(center) @ Matrix.Rotation(math.radians(rot_x_deg), 4, "X") @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    return finish(name, bm, mat, bevel=bevel)


def cyl(name, p0, p1, r, mat, seg=32):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length,
                          matrix=Matrix.Translation((p0 + p1) / 2) @ rot)
    return finish(name, bm, mat, smooth_angle=40)


# curve local (x, y, z) -> machine (y, z, x): a 2D profile drawn in machine Y/Z, extruded along X
AXIS_X = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def profile(name, pts, x0, x1, mat, bevel=0.004, res=12):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = max(0.0005, (x1 - x0) / 2 - bevel)
    cu.bevel_depth = bevel
    cu.bevel_resolution = 4
    cu.resolution_u = res
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    sp.use_cyclic_u = True
    for bp, (y, z, h) in zip(sp.bezier_points, pts):
        bp.co = (y, z, 0.0)
        t = "VECTOR" if h == "V" else "AUTO"
        bp.handle_left_type = t
        bp.handle_right_type = t
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    ob.parent = root
    ob.matrix_basis = Matrix.Translation(((x0 + x1) / 2, 0, 0)) @ AXIS_X
    return ob


def text(name, body, font_file, size, center, mat, shear=0.0, rot=None):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    path = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", font_file)
    if os.path.exists(path):
        cu.font = bpy.data.fonts.load(path, check_existing=True)
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.shear = shear
    cu.extrude = 0.0003
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    ob.parent = root
    ob.location = center
    if rot:
        ob.rotation_euler = rot
    return ob


# ======================================================================================================
# ZAPPA M-1600 geometry, iteration 1 — rebuilt from the photo analysis (7 analysts + lead reconciliation).
#
# Frames:
#  * "model frame": the numbers below. The head (everything on top of the stand) is written in the
#    HEAD frame where the cap runs z 0.99..1.27; a post-pass lifts it by HEAD_DZ. Stand_*/Roll_*/Cable_*
#    objects are already floor-referenced.
#  * The root is finally scaled by TRUE_SCALE so the machine has its real size: the machine's own ruler
#    reads 167.7 cm between the caps (photos 20 and 23).
# Axes: +X = right end (control panel), -Y = front (operator, ruler), +Y = back (levers, rods), Z up.
# ======================================================================================================
TRUE_SCALE = 0.86
HEAD_DZ = 0.07
CAP_IN, CAP_OUT = 0.975, 1.097
CAP_MID = (CAP_IN + CAP_OUT) / 2
CAP_D = 0.329
COL_X = 1.012
Z = PLATEN_Z = 1.10
BAND_B, STRIP_B, STRIP_F, PLATEN_FRONT = 0.005, -0.032, -0.043, -0.081
STICKER_F = RULER_B = -0.116
RULER_F = -0.130
ROLLER_Y = -0.024
PINCH_X = (-0.837, -0.293, -0.107, 0.400, 0.604, 0.890)
GRIT_X = (-0.837, -0.575, -0.293, -0.107, 0.050, 0.218, 0.400, 0.604, 0.705, 0.890)
LONG_GRIT = (-0.837, 0.604, 0.705)
CARRIAGE_X = 0.828
TEX = r"D:\code\son-wowww\blender\textures"

# ------------------------------------------------------------------ extra materials
STAND = principled("CNC_Stand", (0.025, 0.026, 0.029), rough=0.7)[0]
RUST = principled("CNC_Rust", (0.32, 0.19, 0.12), metallic=0.3, rough=0.65)[0]
COPPER = principled("CNC_Copper", (0.62, 0.36, 0.22), metallic=1.0, rough=0.4)[0]
AMBER = principled("CNC_Amber", (0.85, 0.50, 0.12), metallic=0.2, rough=0.3, coat=0.5)[0]
MIRROR = principled("CNC_AluMirror", (0.86, 0.87, 0.88), metallic=1.0, rough=0.12)[0]
PURPLE = principled("CNC_Purple", (0.12, 0.08, 0.45), metallic=0.4, rough=0.35)[0]
GOLD = principled("CNC_Gold", (0.85, 0.65, 0.25), metallic=1.0, rough=0.3)[0]
DARKSTEEL = principled("CNC_DarkSteel", (0.04, 0.04, 0.045), metallic=0.6, rough=0.5)[0]
CREAMBAR = principled("CNC_CreamBar", (0.86, 0.85, 0.78), rough=0.45)[0]
ZINC = principled("CNC_Zinc", (0.70, 0.72, 0.74), metallic=1.0, rough=0.35)[0]
DOT = principled("CNC_Dot", (0.01, 0.01, 0.01), rough=0.8)[0]
REDRING = principled("CNC_RedRing", (0.75, 0.18, 0.08), rough=0.4)[0]
_cb, _cbn, _cbb = principled("CNC_CableBlue", (0.30, 0.65, 0.95), rough=0.3)
_cbb.inputs["Transmission Weight"].default_value = 0.5
CABLE_BLUE = _cb
MARKER = ramp_material("CNC_Marker", "X", 0.001, [(0.0, (0.80, 0.77, 0.64)), (0.7, (0.62, 0.60, 0.50))])


def ribbed_along_x(name, pitch):
    """Black extrusion with ribs running along the machine (profile objects: local Y = machine Z)."""
    m, nt, b = principled(name, (0.028, 0.028, 0.03), metallic=0.45, rough=0.42)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Y"
    wave.inputs["Scale"].default_value = (2 * math.pi / 20) / pitch
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.0015
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


RIB2 = ribbed_along_x("CNC_RibsAlongX", 0.0035)


def hole_row_material(name, pitch, radius):
    """Steel strip with one row of round vacuum holes along X (object coords centred on the row)."""
    steel = (0.62, 0.63, 0.64)
    m, nt, b = principled(name, steel, metallic=1.0, rough=0.3)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    dx = nt.nodes.new("ShaderNodeMath")
    dx.operation = "DIVIDE"
    dx.inputs[1].default_value = pitch
    fr = nt.nodes.new("ShaderNodeMath")
    fr.operation = "FRACT"
    sh = nt.nodes.new("ShaderNodeMath")
    sh.operation = "SUBTRACT"
    sh.inputs[1].default_value = 0.5
    dy = nt.nodes.new("ShaderNodeMath")
    dy.operation = "DIVIDE"
    dy.inputs[1].default_value = pitch
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = radius / pitch
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = (*steel, 1.0)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (0.01, 0.01, 0.01, 1.0)
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    L = nt.links.new
    L(tc.outputs["Object"], sep.inputs[0])
    L(sep.outputs["X"], dx.inputs[0])
    L(dx.outputs[0], fr.inputs[0])
    L(fr.outputs[0], sh.inputs[0])
    L(sh.outputs[0], comb.inputs["X"])
    L(sep.outputs["Y"], dy.inputs[0])
    L(dy.outputs[0], comb.inputs["Y"])
    L(comb.outputs[0], ln.inputs[0])
    L(ln.outputs["Value"], lt.inputs[0])
    L(lt.outputs[0], ramp.inputs["Fac"])
    L(ramp.outputs["Color"], b.inputs["Base Color"])
    L(lt.outputs[0], inv.inputs[1])
    L(inv.outputs[0], b.inputs["Metallic"])
    return m


HOLES = hole_row_material("CNC_HoleRow", 0.0232, 0.0012)


def img_mat(name, file, rough=0.4, alpha=False):
    m, nt, b = principled(name, (1, 1, 1), rough=rough)
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(os.path.join(TEX, file), check_existing=True)
    img.reload()
    if not img.packed_file:
        img.pack()
    tex.image = img
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
        m.surface_render_method = "DITHERED"
    return m


M_LOGO = img_mat("CNC_TexLogo", "logo_zappa.png", rough=0.25, alpha=True)
M_STK_F = img_mat("CNC_TexStickerFront", "sticker_front.png", rough=0.35)
M_STK_B = img_mat("CNC_TexStickerBack", "sticker_back.png", rough=0.35)
M_RULER = img_mat("CNC_TexRuler", "ruler.png", rough=0.45)
M_CAUTION = img_mat("CNC_TexCaution", "caution.png", rough=0.4)
M_LBL_P = img_mat("CNC_TexProductLabel", "label_product.png", rough=0.45)
M_LBL_M = img_mat("CNC_TexModelLabel", "label_model.png", rough=0.45)


# review 1: the real blacks are a cool, low-spec charcoal (the warm/bronze, chrome-ish look was wrong)
def tune(m, base=None, rough=None, spec=None, metallic=None):
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    if base is not None:
        b.inputs["Base Color"].default_value = (*base, 1.0)
        m.diffuse_color = (*base, 1.0)
    if rough is not None:
        b.inputs["Roughness"].default_value = rough
        m.roughness = rough
    if spec is not None:
        b.inputs["Specular IOR Level"].default_value = spec
    if metallic is not None:
        b.inputs["Metallic"].default_value = metallic
        m.metallic = metallic


tune(SATIN, base=(0.026, 0.029, 0.034), rough=0.60, spec=0.30)
tune(STAND, base=(0.015, 0.016, 0.019), rough=0.60, spec=0.25)
tune(BLACK, rough=0.60, spec=0.30)
tune(RIB2, rough=0.65, spec=0.25, metallic=0.0)
next(n for n in RIB2.node_tree.nodes if n.type == "BUMP").inputs["Strength"].default_value = 0.12
MATTE = principled("CNC_MatteBlack", (0.010, 0.010, 0.011), rough=0.78)[0]
tune(MATTE, spec=0.25)
tune(M_LOGO, rough=0.45)
for _m in (M_STK_F, M_STK_B, M_RULER, M_CAUTION, M_LBL_P, M_LBL_M):
    tune(_m, rough=0.5, spec=0.25)


# ------------------------------------------------------------------ helpers
def prism(name, pts_yz, x0, x1, mat, bevel=0.0, segments=3, sharp=30, limit=40):
    """Profile (machine Y/Z) extruded along X, as a mesh so the bevel rounds every edge."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in pts_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in pts_yz]
    n = len(pts_yz)
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = finish(name, bm, mat, bevel=bevel)
    ob.data.set_sharp_from_angle(angle=math.radians(sharp))
    if bevel > 0:
        md = ob.modifiers["Bevel"]
        md.angle_limit = math.radians(limit)
        md.segments = segments
    return ob


def catmull_rom(P, n=8, alpha=0.5, straight_last=True):
    """Closed centripetal Catmull-Rom through P; the span from the last point back to the first stays straight."""
    out = []
    N = len(P)
    for i in range(N):
        if straight_last and i == N - 1:
            out.append(P[i].copy())
            continue
        p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % N], P[(i + 2) % N]

        def tj(ti, a, b):
            return ti + max((b - a).length, 1e-9) ** alpha
        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            A1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            A2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            A3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            B1 = A1 * ((t2 - t) / (t2 - t0)) + A2 * ((t - t0) / (t2 - t0))
            B2 = A2 * ((t3 - t) / (t3 - t1)) + A3 * ((t - t1) / (t3 - t1))
            out.append(B1 * ((t2 - t) / (t2 - t1)) + B2 * ((t - t1) / (t2 - t1)))
    return out


def inset(pts, dist):
    """Offset a clockwise (y right, z up) outline inwards."""
    n = len(pts)
    out = []
    for i in range(n):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        out.append(pts[i] + Vector((t.y, -t.x)) * dist)
    return out


def resample(pts, n):
    """n points evenly spaced by arc length along an open polyline."""
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)
    out = []
    for k in range(n):
        d = total * k / (n - 1)
        i = 0
        while i < len(seg) - 1 and d > seg[i]:
            d -= seg[i]
            i += 1
        out.append(pts[i].lerp(pts[i + 1], min(1.0, d / seg[i]) if seg[i] else 0.0))
    return out


def on_slope(center, angle_deg, ly, lz=0.0):
    """Point on a plane tilted about X by angle_deg (local +Y runs up the slope), from local (y, z)."""
    a = math.radians(angle_deg)
    return (center[0], center[1] + ly * math.cos(a) - lz * math.sin(a), center[2] + ly * math.sin(a) + lz * math.cos(a))


def surface_z(x, y):
    """Height (model frame) of whatever machine part is under (x, y), by ray casting straight down."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mw = root.matrix_world
    hit, loc, *_ = bpy.context.scene.ray_cast(dg, mw @ Vector((x, y, 1.6)), mw.to_3x3() @ Vector((0, 0, -1)))
    return (mw.inverted() @ loc).z if hit else None


def fit_plate(x, y0, y1, lift=0.0008):
    """A flat plate spanning y0..y1 that rests on (never sinks into) the surface below it."""
    ys = [y0 + (y1 - y0) * k / 8 for k in range(9)]
    zs = [surface_z(x, y) for y in ys]
    k = (zs[-1] - zs[0]) / (y1 - y0)
    off = max(z - (zs[0] + k * (y - y0)) for y, z in zip(ys, zs))
    ym = (y0 + y1) / 2
    return (x, ym, zs[0] + k * (ym - y0) + off + lift), math.degrees(math.atan(k))


def decal(name, mat, center, w, h, rot_x=0.0, rot_z=0.0):
    """Textured quad: u along local +X, v along local +Y (image top = +Y), normal +Z before rotation."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new((-w / 2, -h / 2, 0)), bm.verts.new((w / 2, -h / 2, 0)),
          bm.verts.new((w / 2, h / 2, 0)), bm.verts.new((-w / 2, h / 2, 0))]
    f = bm.faces.new(vs)
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    bm.transform(Matrix.Translation(center) @ Matrix.Rotation(math.radians(rot_z), 4, "Z")
                 @ Matrix.Rotation(math.radians(rot_x), 4, "X"))
    return finish(name, bm, mat)


def curve_tube(name, pts, r, mat, smooth=True):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    if smooth:
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = "AUTO"
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for pt, p in zip(sp.points, pts):
            pt.co = (*p, 1.0)
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    col.objects.link(ob)
    ob.parent = root
    return ob


def helix(name, a, b, r, wire, turns, mat):
    a, b = Vector(a), Vector(b)
    pts = []
    n = int(turns * 12)
    for k in range(n + 1):
        t = k / n
        c = a.lerp(b, t)
        ang = 2 * math.pi * turns * t
        pts.append((c.x + r * math.cos(ang), c.y + r * math.sin(ang), c.z))
    return curve_tube(name, pts, wire, mat, smooth=False)


def hexagon(name, center_y, z, x, r, mat):
    """Pointy-top hexagon in the XZ plane facing -Y."""
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=6, radius=r,
                            matrix=Matrix.Translation((x, center_y, z)) @ Matrix.Rotation(math.radians(90), 4, "X")
                            @ Matrix.Rotation(math.radians(30), 4, "Z"))
    return finish(name, bm, mat)


def slotted_wall(top, slots, z_bot, r=0.0085, slot_bottom=0.900):
    """Wall polygon (y/z): flat bottom, top edge given right-to-left, U-slots cut down from the top."""
    pts = [Vector((top[-1][0], z_bot)), Vector((top[0][0], z_bot))]
    zc = slot_bottom + r
    for i in range(len(top) - 1):
        (ya, za), (yb, zb) = top[i], top[i + 1]
        pts.append(Vector((ya, za)))
        for yc in sorted((s for s in slots if yb < s < ya), reverse=True):
            zt = za + (zb - za) * (yc - ya) / (yb - ya)
            pts.append(Vector((yc + r, zt)))
            for k in range(9):
                ang = -math.pi * k / 8
                pts.append(Vector((yc + r * math.cos(ang), zc + r * math.sin(ang))))
            pts.append(Vector((yc - r, zt)))
    pts.append(Vector(top[-1]))
    return [(p.x, p.y) for p in pts]


# ================================================================== STAND (floor-referenced, final heights)
for s, side in ((-1, "L"), (1, "R")):
    xs = s * COL_X

    def X(a, b):
        return (min(s * a, s * b), max(s * a, s * b))

    # foot + casters
    box(f"Stand_Foot_{side}", xs - 0.036, xs + 0.036, -0.3075, 0.3375, 0.081, 0.112, STAND, bevel=0.003)
    for i, y in enumerate((0.315, -0.285, 0.265, -0.235)):
        cyl(f"Stand_FootDot_{side}{i}", (xs, y, 0.112), (xs, y, 0.1125), 0.003, DOT, seg=12)
    for y, tag in ((-0.278, "F"), (0.308, "B")):
        cyl(f"Stand_Wheel_{side}{tag}", (xs - 0.010, y, 0.026), (xs + 0.010, y, 0.026), 0.026, RUBBER)
        cyl(f"Stand_WheelHub_{side}{tag}", (xs - 0.011, y, 0.026), (xs + 0.011, y, 0.026), 0.008, ZINC, seg=16)
        cyl(f"Stand_Swivel_{side}{tag}", (xs, y, 0.050), (xs, y, 0.081), 0.020, BLACK, seg=24)
        cyl(f"Stand_SwivelRing_{side}{tag}", (xs, y, 0.055), (xs, y, 0.063), 0.021, REDRING, seg=24)
        boxes(f"Stand_Fork_{side}{tag}", [(xs - 0.015, xs - 0.012, y - 0.016, y + 0.016, 0.020, 0.055),
                                          (xs + 0.012, xs + 0.015, y - 0.016, y + 0.016, 0.020, 0.055)], BLACK)
    # column: inner face flush with the cap's inner face, an 8 mm recessed channel on its outer face
    xa, xb = X(0.975, 1.041)
    box(f"Stand_Column_{side}", xa, xb, -0.095, 0.125, 0.112, 1.049, STAND, bevel=0.004)
    fa, fb = X(1.041, 1.049)
    boxes(f"Stand_ColumnFlanges_{side}", [(fa, fb, -0.095, -0.035, 0.112, 0.870), (fa, fb, 0.065, 0.125, 0.112, 0.870),
                                          (fa, fb, -0.095, 0.125, 0.870, 1.049)], STAND, bevel=0.002)
    for i, z in enumerate((0.741, 0.581)):
        cyl(f"Stand_ColumnBolt_{side}{i}", (s * 1.041, 0.015, z), (s * 1.046, 0.015, z), 0.0065, RUST, seg=6)
    for i, y in enumerate((0.015 - 0.058, 0.015 + 0.058)):
        cyl(f"Stand_HeadHole_{side}{i}", (s * 1.049, y, 0.975), (s * 1.0494, y, 0.975), 0.004, DOT, seg=12)
    pa, pb = X(COL_X - 0.042, COL_X + 0.042)
    box(f"Stand_TopPlate_{side}", min(pa, pb), max(pa, pb), -0.105, 0.115, 1.049, 1.055, DARKSTEEL, bevel=0.001)
    for i, (dx, y) in enumerate(((-0.02, -0.07), (0.02, -0.07), (-0.02, 0.08), (0.02, 0.08))):
        cyl(f"Stand_Spacer_{side}{i}", (xs + dx, y, 1.055), (xs + dx, y, 1.060), 0.008, DARKSTEEL, seg=16)

    # media arm: open-top U-channel on the column's outer face, U-slots for the rods
    SLOTS = (0.195, 0.285, 0.410, 0.475)
    inner_top = [(0.495, 0.930), (0.180, 0.930), (0.107, 0.960), (-0.077, 0.960), (-0.125, 0.942), (-0.290, 0.942)]
    outer_top = [(0.495, 0.930), (-0.290, 0.930)]
    wa, wb = X(1.049, 1.052)
    prism(f"Stand_ArmInner_{side}", slotted_wall(inner_top, SLOTS, 0.870), wa, wb, STAND, bevel=0.0012)
    oa, ob_ = X(1.097, 1.100)
    prism(f"Stand_ArmOuter_{side}", slotted_wall(outer_top, SLOTS, 0.870), oa, ob_, STAND, bevel=0.0012)
    la, lb = X(1.049, 1.100)
    box(f"Stand_ArmFloor_{side}", la, lb, -0.290, 0.495, 0.870, 0.873, STAND)
    for i, y in enumerate((0.015 - 0.058, 0.015 + 0.058)):
        cyl(f"Stand_TabBolt_{side}{i}", (s * 1.052, y, 0.945), (s * 1.056, y, 0.945), 0.006, RUST, seg=6)
    for i, y in enumerate((-0.240, -0.210)):
        cyl(f"Stand_Rivet_{side}{i}", (s * 1.100, y, 0.905), (s * 1.102, y, 0.905), 0.0055, ALU, seg=16)
    # white roll stopper on one tube at each end, with its fixing nut on the outer wall
    ty = 0.285 if s < 0 else 0.410
    cyl(f"Stand_PlugHub_{side}", (s * 1.100, ty, 0.942), (s * 1.062, ty, 0.942), 0.016, WHITE, seg=24)
    cyl(f"Stand_PlugFlange_{side}", (s * 1.062, ty, 0.942), (s * 1.054, ty, 0.942), 0.024, WHITE, seg=32)
    cyl(f"Stand_Washer_{side}", (s * 1.100, ty, 0.898), (s * 1.1015, ty, 0.898), 0.0085, ZINC, seg=16)
    cyl(f"Stand_Nut_{side}", (s * 1.1015, ty, 0.898), (s * 1.1075, ty, 0.898), 0.0075, ZINC, seg=6)

# one deep crossbar with a recessed neck near its top
boxes("Stand_Crossbar", [(-0.975, 0.975, -0.0175, 0.0475, 0.547, 0.705),
                         (-0.975, 0.975, -0.0075, 0.0375, 0.705, 0.733),
                         (-0.975, 0.975, -0.0175, 0.0475, 0.733, 0.768)], STAND, bevel=0.003)
# 4 roll rods: two thin rods seated in slots, two tubes resting on the wall tops
for i, (y, r, z) in enumerate(((0.195, 0.009, 0.909), (0.285, 0.015, 0.942), (0.410, 0.015, 0.942), (0.475, 0.009, 0.909))):
    cyl(f"Roll_Rod_{i}", (-1.100, y, z), (1.100, y, z), r, ALU)

# ================================================================== END CAPS (head frame)
# traced outline; the back shoulder was re-traced in review 1 (tight ridge, flat 40-50 deg back plane)
CAP_UV = [(0.300, 0.000), (0.226, 0.008), (0.160, 0.040), (0.112, 0.080), (0.045, 0.171), (0.016, 0.246),
          (0.003, 0.328), (0.000, 0.390), (0.006, 0.460), (0.027, 0.530), (0.055, 0.590), (0.093, 0.643),
          (0.137, 0.687), (0.192, 0.724), (0.343, 0.818), (0.538, 0.924), (0.640, 0.970), (0.700, 0.992),
          (0.733, 1.000), (0.756, 0.983), (0.781, 0.952), (0.824, 0.889), (0.860, 0.824), (0.889, 0.758),
          (0.941, 0.628), (0.980, 0.514), (0.993, 0.440),
          (1.000, 0.300), (0.975, 0.098), (0.958, 0.030), (0.925, 0.000)]
CAP_PTS = catmull_rom([Vector((-0.172 + CAP_D * u, 0.99 + 0.28 * v)) for u, v in CAP_UV])


def cap_satin():
    """SATIN plus the moulded crease: a height map (proud outer band stepping down into the recessed D-panel),
    applied only on the cap's outer face, as bump."""
    old = bpy.data.materials.get("CNC_CapSatin")
    if old:
        bpy.data.materials.remove(old)
    m = SATIN.copy()
    m.name = "CNC_CapSatin"
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])

    def math(op, a=None, bval=None, clamp=False):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        if bval is not None:
            n.inputs[1].default_value = bval
        if a is not None:
            nt.links.new(a, n.inputs[0])
        return n
    u = math("DIVIDE", math("ADD", sep.outputs["Y"], 0.172).outputs[0], CAP_D)
    v = math("DIVIDE", math("SUBTRACT", sep.outputs["Z"], 0.99).outputs[0], 0.28)
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(u.outputs[0], comb.inputs["X"])
    nt.links.new(v.outputs[0], comb.inputs["Y"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(os.path.join(TEX, "crease_h.png"), check_existing=True)
    img.reload()
    img.colorspace_settings.name = "Non-Color"
    if not img.packed_file:
        img.pack()
    tex.image = img
    tex.extension = "EXTEND"
    tex.interpolation = "Cubic"
    nt.links.new(comb.outputs[0], tex.inputs["Vector"])
    face = math("DIVIDE", math("SUBTRACT", math("ABSOLUTE", sep.outputs["X"]).outputs[0], 1.075).outputs[0], 0.012,
                clamp=True)
    h = math("MULTIPLY", tex.outputs["Color"])
    nt.links.new(face.outputs[0], h.inputs[1])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.004
    nt.links.new(h.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


CAP_MAT = cap_satin()
for s, side in ((-1, "L"), (1, "R")):
    x0, x1 = sorted((s * CAP_IN, s * CAP_OUT))
    ob = prism(f"Body_Cap_{side}", [(p.x, p.y) for p in CAP_PTS], x0, x1, CAP_MAT, bevel=0.020, segments=4)
    # 20 mm roll on the OUTER face edge only; the inner edge (against beam/apron/platen) stays crisp (~3 mm)
    md = ob.modifiers["Bevel"]
    md.limit_method = "WEIGHT"
    me = ob.data
    bw = me.attributes.get("bevel_weight_edge") or me.attributes.new("bevel_weight_edge", "FLOAT", "EDGE")
    for e in me.edges:
        xs = [abs(me.vertices[i].co.x) for i in e.vertices]
        if all(abs(x - CAP_OUT) < 1e-6 for x in xs):
            bw.data[e.index].value = 1.0
        elif all(abs(x - CAP_IN) < 1e-6 for x in xs):
            bw.data[e.index].value = 0.15
        else:
            bw.data[e.index].value = 0.0

# the crease's inner edge, kept for reference (the crease itself is the cap material's height map)
CREASE_IN = [(0.056, 1.224), (0.011, 1.202), (-0.029, 1.182), (-0.065, 1.165), (-0.098, 1.140), (-0.104, 1.130),
             (-0.110, 1.119), (-0.114, 1.107), (-0.120, 1.080), (-0.117, 1.059), (-0.103, 1.035), (-0.080, 1.018),
             (-0.043, 1.008), (-0.009, 1.004), (0.036, 1.001)]
for s, side in ((-1, "L"), (1, "R")):
    # LED strip in a dark slot, 11 deg, back end higher
    for nm, mat, size, off in (("Cap_LEDSlot", GLOSS, (0.001, 0.175, 0.009), 0.0005),
                               ("Cap_LED", LED, (0.0012, 0.168, 0.0055), 0.0011)):
        bm = bmesh.new()
        m = (Matrix.Translation((s * (CAP_OUT + off), 0.028, 1.105)) @ Matrix.Rotation(math.radians(11), 4, "X")
             @ Matrix.Diagonal((*size, 1.0)))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        finish(f"{nm}_{side}", bm, mat)

# ================================================================== LOWER BODY, PLATEN (head frame)
APRON = [(RULER_B, Z - 0.008, "V"), (0.105, Z - 0.006, "V"), (0.130, 1.080, "V"), (0.143, 1.062, "A"),
         (0.145, 1.035, "A"), (0.140, 1.008, "A"), (0.115, 0.993, "A"), (0.0, 0.990, "A"), (-0.070, 0.991, "A"),
         (-0.100, 0.998, "A"), (-0.130, 1.017, "A"), (-0.152, 1.048, "A"), (-0.160, 1.075, "A"), (-0.140, 1.090, "A")]
profile("Body_Apron", APRON, -CAP_IN, CAP_IN, RIB2, bevel=0.002)
prism("Body_BackShoulder", [(0.105, 1.0945), (0.131, 1.0795), (0.131, 1.0765), (0.105, 1.0915)], -CAP_IN, CAP_IN, SATIN)
box("Body_BottomTray", -CAP_IN, CAP_IN, -0.075, 0.135, 0.990, 0.999, STEEL)
for i in range(9):
    x = -0.92 + 0.23 * i
    cyl(f"Body_TrayScrew_{i}", (x, 0.135, 0.9945), (x, 0.137, 0.9945), 0.004, ZINC, seg=12)
box("Body_StickerStrip", -CAP_IN, CAP_IN, STICKER_F, PLATEN_FRONT, Z - 0.004, Z, MATTE)

box("Platen_Front", -CAP_IN, CAP_IN, PLATEN_FRONT, STRIP_F, Z - 0.004, Z, STEEL)
box("Platen_CutStrip", -CAP_IN, CAP_IN, STRIP_F, STRIP_B, Z - 0.004, Z + 0.0008, WHITE)
box("Platen_Rear", -CAP_IN, CAP_IN, STRIP_B, BAND_B, Z - 0.004, Z, STEEL)
box("Platen_Back", -CAP_IN, CAP_IN, BAND_B, 0.105, Z - 0.004, Z, STEEL)
# staggered rows of vacuum holes: two rows per band, alternate rows offset half a pitch
for i, (yc, off) in enumerate(((-0.0194, 0.0), (-0.0276, 0.0116), (-0.051, 0.0), (-0.060, 0.0116))):
    bm = bmesh.new()
    half = CAP_IN - 0.012
    add_cube(bm, -half, half, -0.0016, 0.0016, -0.00005, 0.00005)
    ob = finish(f"Platen_HoleRow_{i}", bm, HOLES)
    ob.location = (off, yc, Z + 0.00006)

# front numbered sticker (20 .. 1, '1' at the right) on the black strip, ruler on the nose
decal("Sticker_Front", M_STK_F, ((0.7395 + 0.9715) / 2, (-0.081 - 0.108) / 2, Z + 0.0003), 0.232, 0.027)
_zr0, _zr1 = surface_z(0.0, -0.129), surface_z(0.0, -0.117)
_rr = math.degrees(math.atan2(_zr1 - _zr0, 0.012))
decal("Body_Ruler", M_RULER, (0.0, (RULER_F + RULER_B) / 2, (_zr0 + _zr1) / 2 + 0.0006), 2 * CAP_IN, 0.014, rot_x=_rr)

# grit rollers in slots, pinch rollers hanging from the rail
for i, x in enumerate(GRIT_X):
    w = 0.026 if x in LONG_GRIT else 0.0175
    box(f"Grit_Slot_{i}", x - w, x + w, -0.030, -0.018, Z, Z + 0.0002, RUBBER)
    cyl(f"Grit_Roller_{i}", (x - w + 0.002, ROLLER_Y, Z - 0.0075), (x + w - 0.002, ROLLER_Y, Z - 0.0075), 0.007, ALU, seg=20)
    cyl(f"Grit_Key_{i}", (x - w - 0.004, ROLLER_Y, Z), (x - w - 0.004, ROLLER_Y, Z + 0.0003), 0.0035, DOT, seg=12)
for i, x in enumerate(PINCH_X):
    boxes(f"Pinch_Holder_{i}", [(x - 0.0185, x + 0.0185, -0.012, 0.010, Z + 0.024, Z + 0.040),
                                (x - 0.0145, x - 0.0087, -0.035, -0.012, Z + 0.006, Z + 0.028),
                                (x + 0.0087, x + 0.0145, -0.035, -0.012, Z + 0.006, Z + 0.028)], BLACK, bevel=0.001)
    cyl(f"Pinch_Roller_{i}", (x - 0.0075, ROLLER_Y, Z + 0.0095), (x + 0.0075, ROLLER_Y, Z + 0.0095), 0.0095, RUBBER, seg=24)

# ================================================================== RAIL, STRIPS, BEAM (head frame)
box("Body_Rail", -CAP_IN, CAP_IN, -0.031, 0.008, 1.140, 1.163, ALU)
box("Body_CreamBar", -CAP_IN, CAP_IN, -0.027, 0.000, 1.163, 1.182, CREAMBAR, bevel=0.006)
box("Body_MarkerStrip", -CAP_IN, CAP_IN, -0.024, 0.004, 1.182, 1.214, MARKER)
box("Body_BackPlate", -CAP_IN, CAP_IN, 0.040, 0.085, 1.128, 1.200, MIRROR)
for i, x in enumerate(GRIT_X):
    w = 0.055 if x in LONG_GRIT else 0.037
    box(f"Beam_Label_{i}", x - w / 2, x + w / 2, -0.0250, -0.0247, 1.186, 1.197, BLACK)
    box(f"Beam_LabelIn_{i}", x - w / 2 + 0.0045, x + w / 2 - 0.0045, -0.0253, -0.0250, 1.1874, 1.1956, WHITE)
    box(f"Beam_LabelLine_{i}", x - w * 0.4, x + w * 0.4, -0.0256, -0.0253, 1.1938, 1.1947, BLACK)
decal("Body_ModelLabel", M_LBL_M, (-0.930, -0.0252, 1.196), 0.058, 0.020, rot_x=90)

# top beam = cap outline inset 2.5 mm from the front crest to the back crease, small undercut nose,
# steep back lip and a hidden underside
_top = [p for p in inset(CAP_PTS, 0.0025) if p.x >= -0.040 and p.y >= 1.203]   # follows the cap down its back
BEAM = ([(-0.032, 1.215), (-0.041, 1.2215)] + [(p.x, p.y) for p in _top]
        + [(0.110, 1.201), (0.040, 1.205), (0.0, 1.208)])
prism("Body_Beam", BEAM, -CAP_IN, CAP_IN, SATIN, bevel=0.0025)

# ================================================================== BACK: pinch levers, shaft, handle (head frame)
for i, x in enumerate(PINCH_X):
    box(f"Lever_Bracket_{i}", x - 0.028, x + 0.028, 0.085, 0.118, 1.160, 1.203, SATIN, bevel=0.002)
    box(f"Lever_Shelf_{i}", x - 0.027, x + 0.027, 0.104, 0.128, 1.160, 1.170, SATIN, bevel=0.0015)
    box(f"Lever_Tab_{i}", x - 0.009, x + 0.009, 0.098, 0.124, 1.118, 1.165, SATIN)
    box(f"Lever_Foot_{i}", x - 0.020, x + 0.020, 0.098, 0.130, 1.097, 1.116, SATIN, bevel=0.0015)
    for j, dx in enumerate((-0.018, 0.018)):
        cyl(f"Lever_Knob_{i}{j}", (x + dx, 0.116, 1.170), (x + dx, 0.116, 1.184), 0.0075, SATIN, seg=16)
        cyl(f"Lever_KnobTip_{i}{j}", (x + dx, 0.116, 1.184), (x + dx, 0.116, 1.188), 0.002, BRASS, seg=10)
        helix(f"Lever_Spring_{i}{j}", (x + dx, 0.122, 1.162), (x + dx * 1.22, 0.122, 1.116), 0.0038, 0.0008, 14, COPPER)
cyl("Body_LiftShaft", (-0.959, 0.100, 1.165), (0.959, 0.100, 1.165), 0.0093, ALU, seg=6)
for s, side in ((-1, "L"), (1, "R")):
    cyl(f"Body_Stopper_{side}", (s * 0.975, 0.094, 1.195), (s * 0.957, 0.094, 1.195), 0.0064, AMBER, seg=16)
cyl("Body_ShaftBushing_R", (0.957, 0.100, 1.165), (0.975, 0.100, 1.165), 0.0099, WHITE, seg=20)
cyl("Body_ShaftWasher_L", (-0.963, 0.100, 1.165), (-0.960, 0.100, 1.165), 0.0116, ALU, seg=20)
cyl("Lift_Collar", (0.922, 0.100, 1.165), (0.955, 0.100, 1.165), 0.014, SATIN, seg=24)
tilted_box("Lift_Arm", (0.030, 0.100, 0.007), (0.938, 0.1375, 1.1315), -42, SATIN, bevel=0.0015)
box("Lift_Paddle", 0.929, 0.991, 0.168, 0.200, 1.088, 1.096, SATIN, bevel=0.0015)
box("Lift_Lip", 0.984, 0.991, 0.168, 0.200, 1.096, 1.104, SATIN)
# back product label (readable from behind) and the back numbered sticker on the shoulder
decal("Back_Label", M_LBL_P, (-0.930, 0.137, 1.073), 0.090, 0.042, rot_x=45, rot_z=180)
decal("Back_Sticker", M_STK_B, (0.837, 0.1185, 1.0875), 0.232, 0.0265, rot_x=29, rot_z=180)

# ================================================================== CARRIAGE (head frame)
cx = CARRIAGE_X
prism("Carriage_Body", [(-0.084, Z + 0.004), (-0.084, Z + 0.086), (-0.068, Z + 0.104), (0.020, Z + 0.104),
                        (0.020, Z + 0.004)], 0.7725, 0.8835, SATIN, bevel=0.004)
hexagon("Carriage_Badge", -0.0852, Z + 0.050, cx, 0.033, BLUE)
hexagon("Carriage_BadgeRing", -0.0855, Z + 0.050, cx, 0.0297, GOLD)
hexagon("Carriage_BadgeIn", -0.0858, Z + 0.050, cx, 0.0283, BLUE)
text("Carriage_BadgeZ", "Z", "ariblk.ttf", 0.022, (cx, -0.0862, Z + 0.065), GOLD, shear=0.15,
     rot=(math.radians(90), 0, 0))
text("Carriage_BadgeText", "ZAPPA", "ariblk.ttf", 0.0115, (cx, -0.0862, Z + 0.044), ALU, rot=(math.radians(90), 0, 0))
text("Carriage_BadgeTag", "PAINT PROTECTION FILM", "arialbd.ttf", 0.004, (cx, -0.0862, Z + 0.035), WHITE,
     rot=(math.radians(90), 0, 0))
box("Carriage_ToolHolder", 0.641, 0.765, -0.057, -0.006, Z + 0.002, Z + 0.039, SATIN, bevel=0.003)
box("Carriage_ToolBlock", 0.641, 0.678, -0.057, -0.006, Z + 0.002, Z + 0.044, SATIN, bevel=0.005)
for i, yc in enumerate((-0.043, -0.024)):
    box(f"Carriage_ToolChannel_{i}", 0.685, 0.760, yc - 0.004, yc + 0.004, Z + 0.030, Z + 0.0392, GLOSS)
    box(f"Carriage_ToolTab_{i}", 0.6825, 0.685, yc - 0.0035, yc + 0.0035, Z + 0.039, Z + 0.046, ALU)
box("Carriage_Sticker", 0.664, 0.716, -0.0574, -0.0571, Z + 0.009, Z + 0.023, WHITE)
BX, BY = 0.900, -0.038
cyl("Carriage_BladeBody", (BX, BY, Z + 0.003), (BX, BY, Z + 0.041), 0.0105, BLACK, seg=24)
cyl("Carriage_BladeRing", (BX, BY, Z + 0.041), (BX, BY, Z + 0.046), 0.0099, PURPLE, seg=24)
cyl("Carriage_BladeCap", (BX, BY, Z + 0.046), (BX, BY, Z + 0.060), 0.006, ALU, seg=16)
cyl("Carriage_BladePin", (BX, BY, Z + 0.060), (BX, BY, Z + 0.067), 0.0017, ALU, seg=10)
cyl("Carriage_BladeKnob", (BX + 0.005, BY - 0.008, Z + 0.015), (BX + 0.005, BY - 0.020, Z + 0.015), 0.008, BLACK, seg=20)

# ================================================================== CONTROL PANEL, POWER, CAUTION (head frame)
PC, PANEL_ROT = fit_plate(CAP_MID, -0.074, 0.030)
tilted_box("Panel_Plate", (0.078, 0.115, 0.0015), PC, PANEL_ROT, GLOSS, bevel=0.001)
tilted_box("Panel_LCD", (0.064, 0.019, 0.0010), on_slope(PC, PANEL_ROT, 0.0575 - 0.0132, 0.0012), PANEL_ROT, LCD)
KEYS = [(0.0, 0.0464), (-0.0185, 0.0641), (0.0, 0.0641), (0.0185, 0.0641), (0.0, 0.0818),
        (-0.0265, 0.1026), (-0.0088, 0.1026), (0.0088, 0.1026), (0.0265, 0.1026)]
for i, (dx, d) in enumerate(KEYS):
    ly = 0.0575 - d
    p, q, r_ = (on_slope(PC, PANEL_ROT, ly, h) for h in (0.0007, 0.0013, 0.0016))
    cyl(f"Panel_KeyRing_{i}", (p[0] + dx, p[1], p[2]), (q[0] + dx, q[1], q[2]), 0.0062, WHITE, seg=20)
    cyl(f"Panel_KeyFace_{i}", (q[0] + dx, q[1], q[2]), (r_[0] + dx, r_[1], r_[2]), 0.0052, GLOSS, seg=20)
for i, (dx, lab) in enumerate(((-0.0265, "Reset"), (-0.0088, "Pause"), (0.0088, "Setup"), (0.0265, "Test"))):
    c = on_slope(PC, PANEL_ROT, 0.0575 - 0.111, 0.0012)
    text(f"Panel_Label_{i}", lab, "arial.ttf", 0.0025, (c[0] + dx, c[1], c[2]), WHITE, rot=(math.radians(PANEL_ROT), 0, 0))
_pz = surface_z(CAP_MID, -0.100)
_n = Vector((0, -math.sin(math.radians(28)), math.cos(math.radians(28))))
_p0 = Vector((CAP_MID, -0.100, _pz))
cyl("Panel_PowerRing", _p0, _p0 + _n * 0.0015, 0.0117, GLOSS, seg=28)
cyl("Panel_Power", _p0 + _n * 0.0015, _p0 + _n * 0.0026, 0.0088, SATIN, seg=28)
cyl("Panel_PowerLED", _p0 + _n * 0.0026 + Vector((0, 0.0, -0.0058)), _p0 + _n * 0.0029 + Vector((0, 0, -0.0058)),
    0.0013, LED, seg=10)

# CAUTION sticker wrapped on the right cap's nose, set toward the cap's inner side
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
R = 0.1008 + 0.0008
rows = []
for k in range(6):
    th = math.radians(-19 + 27 * k / 5)
    y, z = -0.072 - R * math.cos(th), 1.097 + R * math.sin(th)
    rows.append((bm.verts.new((CAP_IN + 0.003, y, z)), bm.verts.new((CAP_IN + 0.096, y, z)), k / 5))
for k in range(5):
    (a0, a1, v0), (b0, b1, v1) = rows[k], rows[k + 1]
    f = bm.faces.new((a0, a1, b1, b0))
    for loop, uv in zip(f.loops, ((0, v0), (1, v0), (1, v1), (0, v1))):
        loop[uvl].uv = uv
bm.normal_update()
finish("Cap_Caution", bm, M_CAUTION)

# ================================================================== PORTS, POWER INLET, CABLES
box("Port_BayR", 0.982, 1.040, 0.149, 0.1575, 1.012, 1.108, GLOSS)
box("Port_USB", 1.004 - 0.007, 1.004 + 0.007, 0.1575, 0.1585, 1.093 - 0.0065, 1.093 + 0.0065, DOT)
box("Port_Small", 1.004 - 0.0045, 1.004 + 0.0045, 0.1575, 0.1585, 1.073 - 0.0025, 1.073 + 0.0025, DOT)
box("Port_RJ45", 1.008 - 0.00925, 1.008 + 0.00925, 0.1575, 0.1585, 1.043 - 0.008, 1.043 + 0.008, DOT)
box("Port_Label", 1.026, 1.038, 0.1575, 0.1580, 1.019, 1.106, WHITE)
box("Port_Hood", 0.990, 1.025, 0.1575, 0.164, 1.108, 1.114, GLOSS)
box("Port_BayL", -1.032, -0.999, 0.149, 0.1575, 1.040, 1.120, GLOSS)
box("Port_Switch", -1.0235, -1.0075, 0.1575, 0.1635, 1.090, 1.116, BLACK, bevel=0.001)
box("Port_IEC", -1.0315, -0.9995, 0.1575, 0.1590, 1.052, 1.078, DOT)
tilted_box("Port_Plug", (0.030, 0.046, 0.037), (-1.0155, 0.180, 1.054), -30, RUBBER, bevel=0.003)
curve_tube("Cable_USB", [(1.004, 0.160, 1.163), (1.006, 0.20, 1.14), (1.01, 0.235, 1.00), (1.02, 0.235, 0.70),
                         (1.07, 0.36, 0.003), (1.07, 0.76, 0.003)], 0.0032, CABLE_BLUE)
curve_tube("Cable_Power", [(-1.016, 0.20, 1.12), (-1.02, 0.235, 0.70), (-1.07, 0.36, 0.004), (-1.07, 0.70, 0.004)],
           0.004, RUBBER)

# ================================================================== ZAPPA sticker on the beam's front slope
_z0, _z1 = surface_z(0.883, 0.022), surface_z(0.883, 0.066)
LOGO_ROT = math.degrees(math.atan2(_z1 - _z0, 0.044))
_mid = surface_z(0.883, 0.044)
LC = (0.883, 0.044, max(_mid, (_z0 + _z1) / 2) + 0.0009)
decal("Logo_ZAPPA", M_LOGO, LC, 0.174, 0.046, rot_x=LOGO_ROT)

# ================================================================== post-pass: lift the head, true size
for ob in col.objects:
    if ob is not root and not ob.name.startswith(("Stand_", "Roll_", "Cable_")):
        ob.location.z += HEAD_DZ
root.scale = (TRUE_SCALE,) * 3

bpy.ops.wm.save_mainfile()
print(f"built CNC_M1600 v3: {len(col.objects)} objects; panel tilt {PANEL_ROT:.1f}, logo tilt {LOGO_ROT:.1f}, "
      f"ruler tilt {_rr:.1f}; cap pts {len(CAP_PTS)}; beam pts {len(BEAM)}")
