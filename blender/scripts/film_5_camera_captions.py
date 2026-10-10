"""PPF film: camera (16:9), on-screen Vietnamese captions, end card, fades, and shot housekeeping.

Timeline (24 fps) follows the built animation:
  1-71 opening on the plotter | 72-252 cutting | 252-300 film pushed out | 312 piece separates | 312-414 lift, fly,
  drape over the hood | 420-524 five layers | 530-604 liner peel + apply | 650-806 every panel bursts + returns |
  848-1118 scratch test + self-healing | 1121-1296 hero orbit + end card.
Camera = FilmCam with a Track To on CamTarget; both keyed. Hard cuts use CONSTANT keys; motion blur samples from the
frame START so a cut never smears. Captions are flat text parented to the camera at a lens-driven depth, so they keep
the same size on screen whatever the focal length. Re-runnable.
"""
import math
import bpy
from mathutils import Vector

scene = bpy.context.scene
prefs = bpy.context.preferences.edit
_old_interp, _old_handle = prefs.keyframe_new_interpolation_type, prefs.keyframe_new_handle_type
FPS, END = 24, 1310
GOLD = (0.957, 0.698, 0.137)

# ------------------------------------------------------------------ shots: segments separated by hard cuts
# key = (frame, eye, target, lens)
SEGMENTS = [
    [  # S1 opening: slow push on the control-panel end
        (1, (-2.35, 2.75, 1.62), (-4.15, 1.15, 1.04), 40),
        (64, (-2.75, 2.25, 1.40), (-4.15, 1.10, 1.04), 46),
    ],
    [  # S2 the machine at work, high over the cutting table
        (65, (-2.55, 0.15, 1.95), (-4.05, 0.62, 1.00), 26),
        (128, (-2.65, 0.95, 1.80), (-4.05, 0.62, 1.00), 27),
    ],
    [  # S3 behind the machine: the 1.52 m roll turns
        (129, (-5.45, -0.55, 0.62), (-4.50, 0.35, 0.86), 30),
        (176, (-5.40, -0.20, 0.70), (-4.50, 0.55, 0.88), 32),
    ],
    [  # S4-S5 the hood outline grows on the film, rising to look down the table
        (177, (-2.60, -0.90, 2.90), (-3.55, 0.60, 1.00), 28),
        (252, (-2.20, -0.30, 3.20), (-3.30, 0.60, 1.00), 28),
        (312, (-1.75, 0.60, 3.60), (-2.95, 0.60, 1.00), 30),
    ],
    [  # S6-S7 the piece separates, lifts and flies to the hood; S8 five layers
        (313, (-2.15, -0.75, 1.30), (-3.00, 0.60, 1.10), 28),
        (345, (-2.05, -0.85, 1.45), (-2.75, 0.75, 1.50), 28),
        (372, (-1.55, 1.90, 2.90), (-1.25, 1.25, 2.00), 30),
        (398, (0.90, 4.90, 2.35), (0.00, 1.75, 1.45), 32),
        (420, (1.25, 4.95, 2.30), (-0.20, 1.75, 1.55), 32),
        (528, (1.75, 4.75, 2.20), (-0.25, 1.75, 1.50), 34),
    ],
    [  # S9 peel + apply; S10 swoop to the front; S11-S13 burst, orbit, top-down return
        (529, (1.55, 3.55, 1.55), (0.00, 1.95, 1.25), 34),
        (612, (1.35, 3.40, 1.40), (0.00, 1.85, 1.12), 36),
        (650, (0.00, 7.40, 0.85), (0.00, 0.40, 0.85), 32),
        (662, (0.00, 7.70, 0.95), (0.00, 0.40, 0.90), 28),
        (700, (3.30, 6.60, 1.35), (0.00, 0.30, 0.90), 28),
        (730, (6.60, 1.50, 1.90), (0.00, 0.10, 0.90), 28),
        (760, (5.20, -4.60, 2.60), (0.00, -0.20, 0.90), 28),
        (806, (1.20, -2.40, 7.40), (0.00, 0.30, 0.60), 30),
        (836, (1.60, 3.40, 2.40), (0.00, 1.72, 1.10), 33),
        (860, (-0.05, 2.95, 1.85), (0.00, 1.72, 1.08), 32),
        (1000, (0.06, 2.92, 1.83), (0.02, 1.72, 1.08), 33),
        (1104, (0.02, 2.90, 1.82), (0.00, 1.72, 1.08), 34),
        (1120, (0.10, 3.10, 1.95), (0.00, 1.70, 1.05), 33),
    ],
    [  # S17 hero orbit, rear-right -> profile -> front-right; S18 end card push
        (1121, (4.40, -5.20, 0.90), (0.00, -0.30, 0.75), 35),
        (1180, (6.50, 0.40, 1.00), (0.00, 0.10, 0.75), 35),
        (1240, (4.20, 6.20, 0.80), (0.00, 0.45, 1.05), 35),
        (1310, (3.85, 5.75, 0.78), (0.00, 0.45, 1.12), 36),
    ],
]

# ------------------------------------------------------------------ camera + target
for name in ("FilmCam", "CamTarget"):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
cam_data = bpy.data.cameras.get("FilmCam") or bpy.data.cameras.new("FilmCam")
cam_data.animation_data_clear()
cam_data.sensor_fit = "HORIZONTAL"
cam_data.sensor_width = 36.0
cam_data.clip_start = 0.01
cam_data.clip_end = 200.0
cam = bpy.data.objects.new("FilmCam", cam_data)
tgt = bpy.data.objects.new("CamTarget", None)
tgt.empty_display_size = 0.15
coll = bpy.data.collections.get("Film_Camera")
if coll is None:
    coll = bpy.data.collections.new("Film_Camera")
    scene.collection.children.link(coll)
for o in list(coll.objects):
    if o.name.startswith(("Cap_", "Txt_")):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        try:
            if data and data.users == 0:
                (bpy.data.curves if isinstance(data, bpy.types.Curve) else bpy.data.meshes).remove(data)
        except ReferenceError:
            pass
coll.objects.link(cam)
coll.objects.link(tgt)
tc = cam.constraints.new("TRACK_TO")
tc.target = tgt
tc.track_axis = "TRACK_NEGATIVE_Z"
tc.up_axis = "UP_Y"
scene.camera = cam

prefs.keyframe_new_handle_type = "AUTO_CLAMPED"
for seg in SEGMENTS:
    for i, (f, eye, target, lens) in enumerate(seg):
        prefs.keyframe_new_interpolation_type = "CONSTANT" if i == len(seg) - 1 else "BEZIER"
        cam.location = eye
        tgt.location = target
        cam_data.lens = lens
        cam.keyframe_insert("location", frame=f)
        tgt.keyframe_insert("location", frame=f)
        cam_data.keyframe_insert("lens", frame=f)

# ------------------------------------------------------------------ captions (camera-parented flat text)
FONT_B = bpy.data.fonts.load(r"C:\Windows\Fonts\arialbd.ttf", check_existing=True)
FONT_R = bpy.data.fonts.load(r"C:\Windows\Fonts\arial.ttf", check_existing=True)
# with depth = lens/400 the visible frame is x in [-0.045, 0.045], y in [-0.0253, 0.0253] (local), for any lens
HW, HH = 0.045, 0.045 * 9 / 16


def caption(name, body, x, y, size, colour, f_in, f_out, align="LEFT", bold=True, strength=1.6, fade=6, plate=False):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = FONT_B if bold else FONT_R
    cu.size = size
    cu.align_x = align
    cu.align_y = "BOTTOM_BASELINE"
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*colour, 1)
    em.inputs["Strength"].default_value = strength
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.name = "Fade"
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    m.use_backface_culling = True
    cu.materials.append(m)
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    ob.parent = cam
    ob.location = (x, y, -0.1)
    d = ob.driver_add("location", 2).driver
    d.type = "SCRIPTED"
    v = d.variables.new()
    v.name = "lens"
    v.targets[0].id_type = "CAMERA"
    v.targets[0].id = cam_data
    v.targets[0].data_path = "lens"
    d.expression = "-lens/400"
    fac = mix.inputs["Fac"]
    prefs.keyframe_new_interpolation_type = "BEZIER"
    for f, val in ((1, 0.0), (f_in, 0.0), (f_in + fade, 1.0), (f_out - fade, 1.0), (f_out, 0.0)):
        fac.default_value = val
        fac.keyframe_insert("default_value", frame=f)
    # hidden outside its window (cheaper, and no stray transparent pixels)
    prefs.keyframe_new_interpolation_type = "CONSTANT"
    for f, hide in ((1, True), (f_in, False), (f_out + 1, True)):
        ob.hide_render = hide
        ob.keyframe_insert("hide_render", frame=f)
    if plate:
        # dark translucent plate behind the text, so captions read on any background
        bpy.context.view_layer.update()
        xs = [c[0] for c in ob.bound_box]
        ys = [c[1] for c in ob.bound_box]
        px, py = size * 0.45, size * 0.38
        x0, x1, y0, y1 = min(xs) - px, max(xs) + px, min(ys) - py, max(ys) + py
        pm = bpy.data.meshes.new(name + "_bg")
        pm.from_pydata([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], [], [(0, 1, 2, 3)])
        bgm = bpy.data.materials.get(name + "_bg") or bpy.data.materials.new(name + "_bg")
        bgm.use_nodes = True
        bnt = bgm.node_tree
        bnt.nodes.clear()
        bo = bnt.nodes.new("ShaderNodeOutputMaterial")
        be = bnt.nodes.new("ShaderNodeEmission")
        be.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
        bt = bnt.nodes.new("ShaderNodeBsdfTransparent")
        bmx = bnt.nodes.new("ShaderNodeMixShader")
        bnt.links.new(bt.outputs[0], bmx.inputs[1])
        bnt.links.new(be.outputs[0], bmx.inputs[2])
        bnt.links.new(bmx.outputs[0], bo.inputs["Surface"])
        bgm.surface_render_method = "BLENDED"
        pm.materials.append(bgm)
        pl = bpy.data.objects.new(name + "_bg", pm)
        coll.objects.link(pl)
        pl.parent = ob
        pl.location = (0, 0, -0.00004)
        bf = bmx.inputs["Fac"]
        prefs.keyframe_new_interpolation_type = "BEZIER"
        for f, val in ((1, 0.0), (f_in, 0.0), (f_in + fade, 0.68), (f_out - fade, 0.68), (f_out, 0.0)):
            bf.default_value = val
            bf.keyframe_insert("default_value", frame=f)
        prefs.keyframe_new_interpolation_type = "CONSTANT"
        for f, hide in ((1, True), (f_in, False), (f_out + 1, True)):
            pl.hide_render = hide
            pl.keyframe_insert("hide_render", frame=f)
    return ob


# timings are in source frames; the cut is speed-ramped (see render list), so windows are sized for that
W, WS, GS = (1, 1, 1), 7.0, 5.5       # white, white emission, gold emission (AgX keeps them bright)
LX, LY, CS = -0.0405, -0.0200, 0.0036  # lower-left caption anchor + size
caption("Txt_01", "Máy cắt phim PPF ZAPPA M-1600", LX, LY, CS, W, 8, 70, strength=WS, plate=True)
caption("Txt_03", "Cắt chính xác theo khuôn nắp capo", LX, LY, CS, W, 120, 250, strength=WS, plate=True, fade=9)
caption("Txt_04", "Một miếng phim hoàn chỉnh", LX, LY, CS, W, 318, 392, strength=WS, plate=True)
caption("Txt_05", "CẤU TẠO 5 LỚP PHIM PPF", LX, 0.0185, 0.0034, GOLD, 426, 524, strength=GS, plate=True)
caption("Txt_06", "Bóc màng lót · dán lên nắp capo", LX, LY, CS, W, 534, 606, strength=WS, plate=True)
caption("Txt_07a", "PPF bảo vệ mọi chi tiết sơn", 0.0, -0.0118, 0.0050, W, 668, 756, align="CENTER", strength=WS,
        plate=True)
caption("Txt_07b", "trên chiếc xe của bạn", 0.0, -0.0186, 0.0050, GOLD, 672, 756, align="CENTER", strength=GS,
        plate=True)
caption("Txt_08", "Thử cào xước", LX, LY, CS, W, 866, 1000, strength=WS, plate=True)
caption("Txt_08tag", "Hình ảnh mô phỏng", 0.0405, -0.0228, 0.0017, (0.85, 0.85, 0.85), 866, 1112, align="RIGHT",
        bold=False, strength=2.0)
caption("Txt_09", "Vết xước tự phục hồi khi gặp nhiệt", LX, LY, CS, W, 1036, 1112, strength=WS, plate=True)
caption("Txt_10a", "STORE DETAILING", 0.0, 0.0158, 0.0072, GOLD, 1246, 1310, align="CENTER", strength=GS, fade=8)
caption("Txt_10b", "Dán phim bảo vệ sơn PPF", 0.0, 0.0108, 0.0030, W, 1250, 1310, align="CENTER", strength=WS,
        fade=8)
caption("Txt_10c", "storedetailing.vn", 0.0, 0.0072, 0.0026, GOLD, 1254, 1310, align="CENTER", bold=False,
        strength=GS, fade=8)

# ------------------------------------------------------------------ the five layer labels: numbered, gold, face the camera
NUM = {"L1_TopCoat": "01", "L2_Gloss": "02", "L3_TPU": "03", "L4_Adhesive": "04", "L5_Liner": "05"}
lm = bpy.data.materials.get("PPF_Label")
if lm:
    b = next(n for n in lm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Color"].default_value = (*GOLD, 1)
    b.inputs["Emission Strength"].default_value = 1.4
for key, num in NUM.items():
    lab = bpy.data.objects.get("Label_" + key)
    if not lab:
        continue
    body = lab.data.body
    if not body[:2].isdigit():
        lab.data.body = f"{num}  {body}"
    lab.data.size = 0.074
    lab.location.x = -0.98              # beyond the hood's -X edge = screen-right in the layers shot
    for c in list(lab.constraints):
        lab.constraints.remove(c)
    t = lab.constraints.new("TRACK_TO")
    t.target = cam
    t.track_axis = "TRACK_Z"
    t.up_axis = "UP_Y"

# ------------------------------------------------------------------ the plotter + table leave once the camera is gone
HIDE_AT = 640


def has_hide_anim(ob):
    ad = ob.animation_data
    if not ad or not ad.action:
        return False
    try:
        fcs = list(ad.action.fcurves)
    except AttributeError:
        fcs = []
        for layer in ad.action.layers:
            for strip in layer.strips:
                cb = strip.channelbag(ad.action_slot) if ad.action_slot else None
                if cb:
                    fcs += list(cb.fcurves)
    return any(fc.data_path == "hide_render" for fc in fcs)


prefs.keyframe_new_interpolation_type = "CONSTANT"
hidden = 0
# collect names first and look each one up: creating actions reshuffles ID lists mid-iteration
_names = [o.name for cname in ("CNC_M1600", "Film_Rig") for o in list(bpy.data.collections[cname].all_objects)]
for cname in ("names",):
    for ob in (bpy.data.objects[n] for n in _names):
        if ob.hide_render and not has_hide_anim(ob):
            continue                      # permanently hidden helpers stay hidden
        if not has_hide_anim(ob):
            ob.hide_render = False
            ob.keyframe_insert("hide_render", frame=1)
        ob.hide_render = True
        ob.keyframe_insert("hide_render", frame=HIDE_AT)
        ob.hide_render = False
        hidden += 1
prefs.keyframe_new_interpolation_type = "BEZIER"
for lname, e in (("Studio_Machine", 380.0), ("Studio_Table", 170.0), ("Studio_MachineRim", 300.0)):
    lo = bpy.data.objects.get(lname)
    if lo:
        lo.data.animation_data_clear()
        for f, val in ((1, e), (HIDE_AT - 2, e), (HIDE_AT, 0.0)):
            lo.data.energy = val
            lo.data.keyframe_insert("energy", frame=f)
# end card: the car lights drop to a third so the brand reads
for lname, e in (("Studio_Strip_0", 650.0), ("Studio_Strip_1", 650.0), ("Studio_Strip_2", 650.0),
                 ("Studio_Strip_3", 650.0), ("Studio_Strip_4", 650.0), ("Studio_Key", 900.0),
                 ("Studio_Fill", 260.0), ("Studio_FrontLow", 220.0)):
    lo = bpy.data.objects.get(lname)
    if lo:
        lo.data.animation_data_clear()
        for f, val in ((1, e), (1238, e), (1258, e * 0.25)):
            lo.data.energy = val
            lo.data.keyframe_insert("energy", frame=f)

# the film sheet reads better a little milkier/bluer; the applied hood film fades to near-invisible as it settles
fm = bpy.data.materials.get("PPF_FilmSheet")
if fm:
    b = next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.80, 0.90, 0.99, 1)
    b.inputs["Transmission Weight"].default_value = 0.2
    b.inputs["Roughness"].default_value = 0.12
    a = b.inputs["Alpha"]
    fm.node_tree.animation_data_clear()
    for f, val in ((1, 0.93), (590, 0.93), (606, 0.18)):
        a.default_value = val
        a.keyframe_insert("default_value", frame=f)

# dark green self-healing cutting mat on the table, so the clear film and the cut line stand out
tm = bpy.data.materials.get("Table_CutMat")
if tm:
    for n in tm.node_tree.nodes:
        if n.type == "VALTORGB":
            n.color_ramp.elements[0].color = (0.010, 0.032, 0.022, 1)
            n.color_ramp.elements[1].color = (0.060, 0.120, 0.085, 1)

# knife line: gold and wide enough to read in a wide shot
cl = bpy.data.objects.get("Film_CutLine")
if cl:
    me = cl.data
    co = [v.co.copy() for v in me.vertices]
    for i in range(0, len(co) - 1, 2):
        m = (co[i] + co[i + 1]) / 2
        d = co[i] - co[i + 1]
        if d.length > 1e-9:
            d.normalize()
            me.vertices[i].co = m + d * 0.0028
            me.vertices[i + 1].co = m - d * 0.0028
    me.update()
cm = bpy.data.materials.get("PPF_CutLine")
if cm:
    b = next(n for n in cm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*GOLD, 1)
    b.inputs["Emission Color"].default_value = (*GOLD, 1)
    b.inputs["Emission Strength"].default_value = 3.0

# fade in from black / out to black; -0.7 EV keeps the yellow paint saturated under the studio strips
vs = scene.view_settings
for f, val in ((1, -7.0), (14, -0.7), (END - 12, -0.7), (END, -8.0)):
    vs.exposure = val
    vs.keyframe_insert("exposure", frame=f)

# frame range, blur that never smears across a cut
scene.frame_start, scene.frame_end = 1, END
scene.render.fps = FPS
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.35
if hasattr(scene.render, "motion_blur_position"):
    scene.render.motion_blur_position = "START"

prefs.keyframe_new_interpolation_type, prefs.keyframe_new_handle_type = _old_interp, _old_handle
scene.frame_set(1)
bpy.ops.wm.save_mainfile()
print(f"camera keys: {sum(len(s) for s in SEGMENTS)} in {len(SEGMENTS)} segments; frames 1-{END} "
      f"({END / FPS:.1f} s); plotter/table objects keyed hidden at {HIDE_AT}: {hidden}")
