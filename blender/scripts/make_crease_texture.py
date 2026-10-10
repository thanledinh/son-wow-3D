"""Height map for the moulded crease on the plotter's end caps (16-bit PNG).

The cap face has a proud outer band that steps DOWN into a recessed D-panel. White = the proud band, black = the
recessed panel (and the back of the cap). Pixel (col, row) maps to head-frame (y, z) of the cap profile:
  y = -0.172 + 0.329 * (col + 0.5) / 1316,   z = 0.99 + 0.28 * (1 - (row + 0.5) / 1120)      (4 px per mm)
python make_crease_texture.py <out.png>
"""
import sys

import numpy as np
from PIL import Image

W, H = 1316, 1120
O = [(0.056, 1.228), (0.009, 1.206), (-0.032, 1.188), (-0.069, 1.174), (-0.109, 1.156), (-0.121, 1.145),
     (-0.133, 1.130), (-0.141, 1.111), (-0.145, 1.076), (-0.137, 1.045), (-0.114, 1.016), (-0.081, 1.001),
     (-0.043, 0.999), (-0.009, 0.999), (0.036, 1.000)]            # outer edge of the crease band
I = [(0.056, 1.224), (0.011, 1.202), (-0.029, 1.182), (-0.065, 1.165), (-0.098, 1.140), (-0.104, 1.130),
     (-0.110, 1.119), (-0.114, 1.107), (-0.120, 1.080), (-0.117, 1.059), (-0.103, 1.035), (-0.080, 1.018),
     (-0.043, 1.008), (-0.009, 1.004), (0.036, 1.001)]            # inner edge (= CREASE_IN in the build)


def resample(pts, n):
    p = np.asarray(pts, float)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.linspace(0.0, s[-1], n)
    return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], axis=1)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


N = 200
O2, I2 = resample(O, N), resample(I, N)
M = (O2 + I2) / 2
nv = O2 - I2
ln = np.linalg.norm(nv, axis=1)
nrm = nv / np.maximum(ln, 1e-9)[:, None]
wk = np.maximum(0.002, ln / 2)
fk = smoothstep(0.0, 0.12, np.arange(N) / (N - 1)) * smoothstep(0.0, 0.12, 1.0 - np.arange(N) / (N - 1))

# nearest point on the crease centre-line POLYLINE (not just its vertices), with normal/width/fade interpolated
# along the segment, so the step edge is smooth instead of saw-toothed
A, B = M[:-1], M[1:]
AB = B - A
L2 = np.maximum((AB ** 2).sum(1), 1e-12)
ys = -0.172 + 0.329 * (np.arange(W) + 0.5) / W
out = np.zeros((H, W), np.float64)
for r0 in range(0, H, 16):
    rows = np.arange(r0, min(H, r0 + 16))
    zs = 0.99 + 0.28 * (1.0 - (rows + 0.5) / H)
    P = np.stack(np.meshgrid(ys, zs), axis=-1).reshape(-1, 2)            # (n, 2)
    AP = P[:, None, :] - A[None, :, :]                                     # (n, N-1, 2)
    s = np.clip((AP * AB[None]).sum(-1) / L2[None], 0.0, 1.0)             # (n, N-1)
    C = A[None] + s[..., None] * AB[None]
    d2 = ((P[:, None, :] - C) ** 2).sum(-1)
    j = d2.argmin(1)
    sj = s[np.arange(len(P)), j][:, None]
    Cj = C[np.arange(len(P)), j]
    nj = nrm[j] * (1 - sj) + nrm[j + 1] * sj
    nj /= np.maximum(np.linalg.norm(nj, axis=1), 1e-9)[:, None]
    wj = wk[j] * (1 - sj[:, 0]) + wk[j + 1] * sj[:, 0]
    fj = fk[j] * (1 - sj[:, 0]) + fk[j + 1] * sj[:, 0]
    t = ((P - Cj) * nj).sum(1) / wj
    out[rows[0]:rows[-1] + 1] = (smoothstep(-1.0, 1.0, t) * fj).reshape(len(rows), W)

Image.fromarray((out * 65535).round().astype(np.uint16)).save(sys.argv[1])
print("saved", sys.argv[1], out.min(), out.max())
