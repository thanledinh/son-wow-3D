"""Dark luxury studio for the PPF film: black glossy floor, overhead LED strips (long reflections on the paint),
key softbox, gold rim lights, a pool of light over the plotter; HDRI only in reflections; EEVEE raytracing,
motion blur, AgX. Re-runnable."""
import math
import os
import bpy
from mathutils import Vector

scene = bpy.context.scene
col = bpy.data.collections.get("Studio")
if col is None:
    col = bpy.data.collections.new("Studio")
    scene.collection.children.link(col)
for o in list(col.objects):
    data = o.data
    bpy.data.objects.remove(o, do_unlink=True)

# the urus file's own helpers are not part of this look
for name in ("ShadowCatcher", "Light"):
    o = bpy.data.objects.get(name)
    if o:
        o.hide_render = True
        o.hide_set(True)

GOLD = (0.957, 0.698, 0.137)


def area(name, loc, target, size, energy, colour=(1, 1, 1), shape="RECTANGLE", size_y=None, spread=180):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = shape
    ld.size = size
    if size_y is not None:
        ld.size_y = size_y
    ld.energy = energy
    ld.color = colour
    ld.spread = math.radians(spread)
    ob = bpy.data.objects.new(name, ld)
    col.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


# overhead LED strips, long along the car (the shop's ceiling has the same lines)
for i, x in enumerate((-2.6, -1.3, 0.0, 1.3, 2.6)):
    area(f"Studio_Strip_{i}", (x, 0.2, 4.6), (x, 0.2, 0.0), 0.16, 650, (1, 1, 1), size_y=6.5, spread=120)
area("Studio_Key", (4.2, 4.6, 2.8), (0.0, 0.8, 0.8), 2.4, 900, (1.0, 0.98, 0.95), size_y=1.6)
area("Studio_Fill", (4.5, -3.5, 1.8), (0.0, -0.5, 0.8), 3.0, 260, (0.85, 0.92, 1.0), size_y=1.5)
area("Studio_RimGoldL", (-3.8, -4.8, 1.6), (0.0, 0.0, 0.9), 1.2, 700, GOLD, size_y=2.4)
area("Studio_RimGoldR", (3.8, -4.8, 1.6), (0.0, 0.0, 0.9), 1.2, 700, GOLD, size_y=2.4)
area("Studio_FrontLow", (0.0, 6.5, 0.6), (0.0, 1.5, 0.7), 4.0, 220, (1.0, 0.96, 0.9), size_y=0.6)
area("Studio_Machine", (-4.1, 0.6, 3.1), (-4.2, 0.6, 1.0), 1.6, 380, (1.0, 0.97, 0.92), size_y=2.6, spread=100)
area("Studio_Table", (-2.8, 0.6, 3.0), (-2.8, 0.6, 1.0), 2.6, 420, (1.0, 0.98, 0.95), size_y=1.4, spread=110)
area("Studio_MachineRim", (-6.2, 2.6, 1.9), (-4.2, 0.6, 1.0), 0.9, 300, GOLD, size_y=1.6)

# black glossy floor, fading out with distance
me = bpy.data.meshes.new("Studio_Floor")
me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new("Studio_Floor", me)
col.objects.link(floor)
m = bpy.data.materials.get("Studio_FloorMat") or bpy.data.materials.new("Studio_FloorMat")
m.use_nodes = True
nt = m.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
b = nt.nodes.new("ShaderNodeBsdfPrincipled")
b.inputs["Base Color"].default_value = (0.006, 0.006, 0.007, 1)
b.inputs["Roughness"].default_value = 0.16
b.inputs["Specular IOR Level"].default_value = 0.6
noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 3.0
rr = nt.nodes.new("ShaderNodeMapRange")
rr.inputs["To Min"].default_value = 0.12
rr.inputs["To Max"].default_value = 0.22
nt.links.new(noise.outputs["Fac"], rr.inputs["Value"])
nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
me.materials.append(m)

# world: HDRI in reflections only, black to the camera
w = bpy.data.worlds.get("Studio_World") or bpy.data.worlds.new("Studio_World")
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputWorld")
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(bpy.utils.resource_path("LOCAL"), "datafiles", "studiolights", "world", "studio.exr"),
                                 check_existing=True)
bg = nt.nodes.new("ShaderNodeBackground")
bg.inputs["Strength"].default_value = 0.35
black = nt.nodes.new("ShaderNodeBackground")
black.inputs["Color"].default_value = (0.002, 0.002, 0.0025, 1)
lp = nt.nodes.new("ShaderNodeLightPath")
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
nt.links.new(bg.outputs[0], mix.inputs[1])
nt.links.new(black.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs["Surface"])
scene.world = w

# render settings
scene.render.engine = "BLENDER_EEVEE"
ee = scene.eevee
for attr, val in (("use_raytracing", True), ("taa_render_samples", 64), ("use_shadows", True),
                  ("use_fast_gi", True), ("ray_tracing_method", "SCREEN")):
    if hasattr(ee, attr):
        try:
            setattr(ee, attr, val)
        except Exception as e:
            print("eevee", attr, e)
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.4
scene.render.fps = 24
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
vs = scene.view_settings
vs.view_transform = "AgX"
for look in ("AgX - Punchy", "Punchy", "AgX - Medium High Contrast"):
    try:
        vs.look = look
        break
    except Exception:
        pass
vs.exposure = 0.0

bpy.ops.wm.save_mainfile()
print("studio ready:", [o.name for o in col.objects], "look:", vs.look)
