"""Speed-ramped edit: which source frames to render, in order (one output frame each, played at 24 fps)."""
import sys

SECTIONS = [  # (first, last, step) in source frames
    (1, 71, 2),       # opening on the plotter
    (72, 252, 3),     # cutting (time-lapse feel)
    (253, 312, 3),    # film pushed out, cut finished
    (313, 419, 2),    # lift, flight, drape
    (420, 500, 1),    # five layers: readable labels
    (501, 528, 2),    # layers merge
    (529, 612, 2),    # liner peel + apply
    (613, 649, 2),    # swoop to the front
    (650, 806, 1.5),  # burst, orbit, return
    (807, 860, 2),    # swoop to the hood
    (861, 1000, 2),   # scratch test
    (1001, 1120, 2),  # self-healing
    (1121, 1240, 2),  # hero orbit
    (1241, 1310, 1),  # end card
]
frames = []
for a, b, step in SECTIONS:
    k = 0
    while True:
        f = a + int(k * step)
        if f > b:
            break
        if not frames or f > frames[-1]:
            frames.append(f)
        k += 1
open(sys.argv[1], "w").write(",".join(str(f) for f in frames))
print(f"{len(frames)} output frames = {len(frames) / 24:.1f} s")
