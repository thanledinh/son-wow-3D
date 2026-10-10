"""blender -b ppf-panels.blend --python render_film.py -- <out_dir> <frames> <res_x> <res_y> <samples> [raytrace 0/1]
<frames> is either 'a-b' (a range, renders every frame, skipping files that already exist) or 'f1,f2,f3'.
Writes JPEG frames named f_####.jpg and prints the time per frame."""
import os
import sys
import time
import bpy

a = sys.argv[sys.argv.index("--") + 1:]
out_dir, frames, rx, ry, samples = a[0], a[1], int(a[2]), int(a[3]), int(a[4])
raytrace = (a[5] == "1") if len(a) > 5 else True
os.makedirs(out_dir, exist_ok=True)
sc = bpy.context.scene
r = sc.render
r.resolution_x, r.resolution_y, r.resolution_percentage = rx, ry, 100
r.image_settings.file_format = "JPEG"
r.image_settings.quality = 90
sc.eevee.taa_render_samples = samples
if hasattr(sc.eevee, "use_raytracing"):
    sc.eevee.use_raytracing = raytrace
rt_scale = a[6] if len(a) > 6 else None
if rt_scale and hasattr(sc.eevee, "ray_tracing_options"):
    try:
        sc.eevee.ray_tracing_options.resolution_scale = rt_scale
    except Exception as e:
        print("rt scale:", e)
if frames.startswith("@"):
    frames = open(frames[1:]).read().strip()
if "-" in frames:
    f0, f1 = (int(v) for v in frames.split("-"))
    todo = list(range(f0, f1 + 1))
else:
    todo = [int(v) for v in frames.split(",")]
t_all = time.time()
done = 0
for f in todo:
    path = os.path.join(out_dir, f"f_{f:04d}.jpg")
    if os.path.exists(path):
        continue
    t = time.time()
    sc.frame_set(f)
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    done += 1
    print(f"RENDER f{f} {time.time() - t:.1f}s", flush=True)
print(f"RENDER done {done} frames in {time.time() - t_all:.0f}s", flush=True)
