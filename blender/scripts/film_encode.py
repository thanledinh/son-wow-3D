"""blender -b --factory-startup --python encode_video.py -- <frames_dir> <framelist.txt> <out.mp4> [fps]
Puts the rendered frames (in the speed-ramped order of framelist.txt) into the sequencer and writes an H.264 MP4.
Missing frames are filled with the previous one, so a partial render still encodes."""
import os
import sys
import bpy

a = sys.argv[sys.argv.index("--") + 1:]
src_dir, flist, out = a[0], a[1], a[2]
fps = int(a[3]) if len(a) > 3 else 24
order = [int(v) for v in open(flist).read().strip().split(",")]
files = []
last = None
for f in order:
    name = f"f_{f:04d}.jpg"
    if os.path.exists(os.path.join(src_dir, name)):
        last = name
    if last:
        files.append(last)
if not files:
    raise SystemExit("no frames yet")

sc = bpy.context.scene
img = bpy.data.images.load(os.path.join(src_dir, files[0]))
w, h = img.size
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
sc.render.fps = fps
sc.frame_start, sc.frame_end = 1, len(files)
sc.sequence_editor_create()
strips = sc.sequence_editor.strips if hasattr(sc.sequence_editor, "strips") else sc.sequence_editor.sequences
st = strips.new_image("film", os.path.join(src_dir, files[0]), channel=1, frame_start=1)
for name in files[1:]:
    st.elements.append(name)
sc.render.use_sequencer = True
ims = sc.render.image_settings
if hasattr(ims, "media_type"):
    try:
        ims.media_type = "VIDEO"
    except Exception as e:
        print("media_type:", e)
ims.file_format = "FFMPEG"
ff = sc.render.ffmpeg
ff.format = "MPEG4"
ff.codec = "H264"
for attr, val in (("constant_rate_factor", "HIGH"), ("ffmpeg_preset", "GOOD"), ("gopsize", 12)):
    try:
        setattr(ff, attr, val)
    except Exception as e:
        print(attr, e)
ff.audio_codec = "NONE"
sc.render.filepath = out
bpy.ops.render.render(animation=True)
real = [f for f in os.listdir(os.path.dirname(out)) if f.startswith(os.path.basename(out).split(".")[0])]
print(f"ENCODED {len(files)} frames ({len(files) / fps:.1f} s) {w}x{h} -> {out}; files: {real}")
