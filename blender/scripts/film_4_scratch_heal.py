"""Stage 4: scratch test and self-healing on the hood film.

A car key drags three strokes across the applied hood film; each stroke's scratches (one texture channel each) are
revealed exactly behind the key tip. After a hold, a warm heat shimmer sweeps the hood and the scratches fade away.
Re-runnable.
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

STROKES = [(0.44, 0.26, 0.74, 0.010), (0.52, 0.22, 0.70, -0.008), (0.60, 0.30, 0.78, 0.012)]  # = texture script
FRAMES = [(862, 902), (910, 950), (958, 998)]
HEAL_START, HEAL_END = 1032, 1104
REST_FRAME = 840
TEX = r"D:\code\son-wowww\blender\textures\scratches.png"

scene = bpy.context.scene
col = bpy.data.collections.get("Film_Scratch")
if col is None:
    col = bpy.data.collections.new("Film_Scratch")
    scene.collection.children.link(col)
for o in list(col.objects):
    data = o.data
    bpy.data.objects.remove(o, do_unlink=True)
    if data is not None and data.users == 0 and data.name in bpy.data.meshes:
        bpy.data.meshes.remove(data)

scene.frame_set(REST_FRAME)
hood = bpy.data.objects["PPF_Hood"]
mw = hood.matrix_world.copy()
W = [mw @ v.co for v in hood.data.vertices]
xs, ys = [p.x for p in W], [p.y for p in W]
xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)


def layer_copy(name, lift, mat):
    me = hood.data.copy()
    me.name = name
    me.transform(mw)
    me.update()
    for v in me.vertices:
        v.co += v.normal * lift
    uvl = me.uv_layers.new(name="HoodUV") if "HoodUV" not in me.uv_layers else me.uv_layers["HoodUV"]
    me.uv_layers.active = uvl
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = ((co.x - xmin) / (xmax - xmin), (co.y - ymin) / (ymax - ymin))
    me.materials.clear()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def fresh_mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree


# ------------------------------------------------------------------ scratch material: 3 channels, 3 reveal values, heal
m, nt = fresh_mat("PPF_Scratches")
out = nt.nodes.new("ShaderNodeOutputMaterial")
b = nt.nodes.new("ShaderNodeBsdfPrincipled")
b.inputs["Base Color"].default_value = (0.92, 0.93, 0.95, 1)
b.inputs["Roughness"].default_value = 0.55
uvn = nt.nodes.new("ShaderNodeUVMap")
uvn.uv_map = "HoodUV"
tex = nt.nodes.new("ShaderNodeTexImage")
img = bpy.data.images.load(TEX, check_existing=True)
img.reload()
if not img.packed_file:
    img.pack()
img.colorspace_settings.name = "Non-Color"
tex.image = img
sep = nt.nodes.new("ShaderNodeSeparateColor")
sepuv = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
nt.links.new(uvn.outputs["UV"], sepuv.inputs[0])
nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
total = None
for i, ch in enumerate(("Red", "Green", "Blue")):
    val = nt.nodes.new("ShaderNodeValue")
    val.name = f"Reveal{i}"
    val.outputs[0].default_value = 0.0
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    nt.links.new(sepuv.outputs["X"], lt.inputs[0])
    nt.links.new(val.outputs[0], lt.inputs[1])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(sep.outputs[ch], mul.inputs[0])
    nt.links.new(lt.outputs[0], mul.inputs[1])
    if total is None:
        total = mul
    else:
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        nt.links.new(total.outputs[0], add.inputs[0])
        nt.links.new(mul.outputs[0], add.inputs[1])
        total = add
heal = nt.nodes.new("ShaderNodeValue")
heal.name = "Heal"
heal.outputs[0].default_value = 0.0
inv = nt.nodes.new("ShaderNodeMath")
inv.operation = "SUBTRACT"
inv.inputs[0].default_value = 1.0
nt.links.new(heal.outputs[0], inv.inputs[1])
alpha = nt.nodes.new("ShaderNodeMath")
alpha.operation = "MULTIPLY"
alpha.use_clamp = True
nt.links.new(total.outputs[0], alpha.inputs[0])
nt.links.new(inv.outputs[0], alpha.inputs[1])
nt.links.new(alpha.outputs[0], b.inputs["Alpha"])
nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
m.surface_render_method = "DITHERED"
SCR_MAT = m

# ------------------------------------------------------------------ heat shimmer material (warm, wavy, pulses during heal)
m, nt = fresh_mat("PPF_HeatGlow")
out = nt.nodes.new("ShaderNodeOutputMaterial")
emi = nt.nodes.new("ShaderNodeEmission")
emi.inputs["Color"].default_value = (1.0, 0.48, 0.14, 1)
tr = nt.nodes.new("ShaderNodeBsdfTransparent")
mix = nt.nodes.new("ShaderNodeMixShader")
tc = nt.nodes.new("ShaderNodeTexCoord")
wave = nt.nodes.new("ShaderNodeTexWave")
wave.inputs["Scale"].default_value = 3.0
wave.inputs["Distortion"].default_value = 6.0
wave.inputs["Detail"].default_value = 3.0
heat = nt.nodes.new("ShaderNodeValue")
heat.name = "Heat"
heat.outputs[0].default_value = 0.0
fac = nt.nodes.new("ShaderNodeMath")
fac.operation = "MULTIPLY"
fac.use_clamp = True
nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
nt.links.new(wave.outputs["Fac"], fac.inputs[0])
nt.links.new(heat.outputs[0], fac.inputs[1])
st = nt.nodes.new("ShaderNodeMath")
st.operation = "MULTIPLY"
st.inputs[1].default_value = 3.0
nt.links.new(heat.outputs[0], st.inputs[0])
nt.links.new(st.outputs[0], emi.inputs["Strength"])
nt.links.new(fac.outputs[0], mix.inputs["Fac"])
nt.links.new(tr.outputs[0], mix.inputs[1])
nt.links.new(emi.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs["Surface"])
m.surface_render_method = "BLENDED"
HEAT_MAT = m

scr = layer_copy("PPF_ScratchLayer", 0.0009, SCR_MAT)
glow = layer_copy("PPF_HeatGlow", 0.0014, HEAT_MAT)

# ------------------------------------------------------------------ the key (tip at the origin, blade up its +Z)
bm = bmesh.new()


def add_box(bm, x0, x1, y0, y1, z0, z1):
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
                          @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))


add_box(bm, -0.006, 0.006, -0.0012, 0.0012, 0.0, 0.058)          # blade
for k in range(4):                                                # cut teeth
    add_box(bm, 0.004, 0.0075, -0.0012, 0.0012, 0.012 + 0.010 * k, 0.017 + 0.010 * k)
add_box(bm, -0.010, 0.010, -0.0025, 0.0025, 0.056, 0.062)          # shoulder
blade_me = bpy.data.meshes.new("Scratch_KeyBlade")
bm.to_mesh(blade_me)
bm.free()
steel = bpy.data.materials.get("CNC_Alu")
blade_me.materials.append(steel)
key = bpy.data.objects.new("Scratch_Key", blade_me)
col.objects.link(key)
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0, 0.088)) @ Matrix.Diagonal((0.034, 0.012, 0.052, 1)))
head_me = bpy.data.meshes.new("Scratch_KeyHead")
bm.to_mesh(head_me)
bm.free()
head_me.materials.append(bpy.data.materials.get("CNC_BlackGloss"))
head = bpy.data.objects.new("Scratch_KeyHead", head_me)
col.objects.link(head)
head.parent = key
bv = head.modifiers.new("Round", "BEVEL")
bv.width = 0.008
bv.segments = 4
for p in head_me.polygons:
    p.use_smooth = True


# ------------------------------------------------------------------ animation
def surface_at(x, y):
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_ = scene.ray_cast(dg, Vector((x, y, 3.0)), Vector((0, 0, -1)))
    return loc.z if hit else None


def uv_to_world(u, v):
    return xmin + u * (xmax - xmin), ymin + v * (ymax - ymin)


for ob in (key,):
    ob.animation_data_clear()
key.rotation_mode = "XYZ"
for nt_ in (SCR_MAT.node_tree, HEAT_MAT.node_tree):
    nt_.animation_data_clear()


def kv(sock, f, v):
    sock.default_value = v
    sock.keyframe_insert("default_value", frame=f)


def key_pose(f, x, y, z, lean=-0.7, lift=0.0, visible=True):
    key.location = (x, y, z + lift)
    key.rotation_euler = Euler((0.0, lean, 0.25))
    key.keyframe_insert("location", frame=f)
    key.keyframe_insert("rotation_euler", frame=f)


scene.frame_set(REST_FRAME)
key.hide_viewport = key.hide_render = True
key.keyframe_insert("hide_viewport", frame=1)
key.keyframe_insert("hide_render", frame=1)
key.hide_viewport = key.hide_render = False
key.keyframe_insert("hide_viewport", frame=FRAMES[0][0] - 14)
key.keyframe_insert("hide_render", frame=FRAMES[0][0] - 14)
key.hide_viewport = key.hide_render = True
key.keyframe_insert("hide_viewport", frame=FRAMES[-1][1] + 16)
key.keyframe_insert("hide_render", frame=FRAMES[-1][1] + 16)
key.hide_viewport = key.hide_render = False
for hide_ob in (head,):
    pass

reveals = [SCR_MAT.node_tree.nodes[f"Reveal{i}"].outputs[0] for i in range(3)]
for i, ((v0, u0, u1, bow), (fs, fe)) in enumerate(zip(STROKES, FRAMES)):
    kv(reveals[i], 1, 0.0)
    kv(reveals[i], fs, u0 - 0.002)
    x0, y0 = uv_to_world(u0, v0)
    z0 = surface_at(x0, y0)
    key_pose(fs - 12, x0 - 0.05, y0, z0, lift=0.10)
    key_pose(fs, x0, y0, z0)
    for f in range(fs, fe + 1, 2):
        t = (f - fs) / (fe - fs)
        t = t * t * (3 - 2 * t)
        u = u0 + (u1 - u0) * t
        v = v0 + bow * math.sin(math.pi * t)
        x, y = uv_to_world(u, v)
        z = surface_at(x, y)
        key_pose(f, x, y, z)
        kv(reveals[i], f, u + 0.002)
    xe, ye = uv_to_world(u1, v0)
    key_pose(fe + 6, xe + 0.04, ye, surface_at(xe, ye), lift=0.08)
    kv(reveals[i], fe + 1, 1.0)

healv = SCR_MAT.node_tree.nodes["Heal"].outputs[0]
heatv = HEAT_MAT.node_tree.nodes["Heat"].outputs[0]
kv(healv, 1, 0.0)
kv(healv, HEAL_START + 10, 0.0)
kv(healv, HEAL_END, 1.0)
kv(heatv, 1, 0.0)
kv(heatv, HEAL_START, 0.0)
kv(heatv, HEAL_START + 18, 0.55)
kv(heatv, HEAL_END - 12, 0.45)
kv(heatv, HEAL_END + 10, 0.0)

# scratch/glow layers only exist on the hood after the burst has settled
for ob in (scr, glow):
    for f, vis in ((1, False), (FRAMES[0][0] - 2, True), (HEAL_END + 14, False)):
        ob.hide_viewport = ob.hide_render = not vis
        ob.keyframe_insert("hide_viewport", frame=f)
        ob.keyframe_insert("hide_render", frame=f)

scene.frame_end = max(scene.frame_end, HEAL_END + 72)
scene.frame_set(1)
bpy.ops.wm.save_mainfile()
print(f"hood uv box x {xmin:.3f}..{xmax:.3f} y {ymin:.3f}..{ymax:.3f}; strokes {FRAMES}; heal {HEAL_START}-{HEAL_END}")
