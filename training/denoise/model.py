"""LightBench raw denoiser: a small U-Net on packed Bayer data, conditioned on the noise level.

Written from scratch for LightBench (no code copied from rawnind_jddc, which is GPL-3.0). The layout is a plain
4-level U-Net (two 3x3 convs per level, max-pool down, 2x2 transposed conv up, concatenated skips), the most
portable shape for onnxruntime-web's WebGPU EP and for a hand-written WGSL port: Conv, LeakyRelu, MaxPool,
ConvTranspose, Concat, Mul, Add, Max, Sqrt only.

Input  x: [N, 4, H, W]  packed RGGB photosites, black-subtracted and divided by (white - black), NOT white
                        balanced (the same domain as darktable's noise profiles; see PLAN.md section 2.3).
       a, b: [N, 4, 1, 1] Poisson-Gaussian noise parameters per packed channel: var(x) = a*x + b.
Output   : [N, 4, H, W]  denoised packed photosites in the same domain (residual: x + correction).

H and W must be multiples of 16 (4 poolings). Sizes for width 16/24/32 are in PLAN.md section 3.2.
"""
from __future__ import annotations

import torch
from torch import nn


def conv_block(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1),
        nn.LeakyReLU(0.2, inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1),
        nn.LeakyReLU(0.2, inplace=True),
    )


class RawDenoiseUNet(nn.Module):
    def __init__(self, width: int = 24, levels: int = 4, in_ch: int = 4, cond: bool = True,
                 sigma_scale: float = 16.0):
        super().__init__()
        self.cond = cond
        self.levels = levels
        # sigma is ~1e-3..1e-1 in normalised units; scaling it keeps the first conv's inputs O(0.1..1).
        self.sigma_scale = sigma_scale
        chans = [width * 2 ** i for i in range(levels + 1)]
        cin = in_ch * (2 if cond else 1)
        self.down = nn.ModuleList()
        for c in chans:
            self.down.append(conv_block(cin, c))
            cin = c
        self.pool = nn.MaxPool2d(2)
        self.up = nn.ModuleList()
        self.dec = nn.ModuleList()
        for i in range(levels, 0, -1):
            self.up.append(nn.ConvTranspose2d(chans[i], chans[i - 1], 2, stride=2))
            self.dec.append(conv_block(2 * chans[i - 1], chans[i - 1]))
        self.head = nn.Conv2d(width, in_ch, 1)
        nn.init.zeros_(self.head.weight)  # start as the identity (residual output = input)
        nn.init.zeros_(self.head.bias)

    def noise_map(self, x: torch.Tensor, a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
        # Per-photosite standard deviation predicted by the profile. b can be negative in darktable profiles.
        var = torch.clamp(a * torch.clamp(x, min=0.0) + b, min=1e-10)
        return torch.sqrt(var) * self.sigma_scale

    def forward(self, x: torch.Tensor, a: torch.Tensor | None = None, b: torch.Tensor | None = None):
        h = x
        if self.cond:
            assert a is not None and b is not None, "conditioned model needs a and b"
            h = torch.cat([x, self.noise_map(x, a, b)], dim=1)
        skips = []
        for i, block in enumerate(self.down):
            h = block(h if i == 0 else self.pool(h))
            skips.append(h)
        h = skips.pop()
        for up, dec in zip(self.up, self.dec):
            h = dec(torch.cat([up(h), skips.pop()], dim=1))
        return x + self.head(h)


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def count_macs(model: nn.Module, hw: tuple[int, int] = (256, 256)) -> int:
    """Multiply-accumulates of the convolutions for one [1, 4, H, W] tile (forward hooks; no extra package)."""
    macs = 0

    def hook(mod, inp, out):
        nonlocal macs
        if isinstance(mod, nn.Conv2d):
            k = mod.kernel_size[0] * mod.kernel_size[1] * mod.in_channels // mod.groups
            macs += out.numel() * k
        elif isinstance(mod, nn.ConvTranspose2d):
            macs += out.numel() * mod.in_channels // mod.groups  # each output gets one tap per input channel

    handles = [m.register_forward_hook(hook) for m in model.modules()
               if isinstance(m, (nn.Conv2d, nn.ConvTranspose2d))]
    x = torch.rand(1, 4, *hw)
    ab = torch.full((1, 4, 1, 1), 1e-4)
    with torch.no_grad():
        model(x, ab, ab * 0)
    for h in handles:
        h.remove()
    return macs


class ExportWrapper(nn.Module):
    """What the browser runs: fixed tile, inputs (x, a, b), output clamped to >= 0. Clipped photosites are
    restored outside the graph (LightBench keeps the original value where x >= the clip level)."""

    def __init__(self, net: RawDenoiseUNet):
        super().__init__()
        self.net = net

    def forward(self, x, a, b):
        return torch.clamp(self.net(x, a, b), min=0.0)


if __name__ == "__main__":
    for w in (16, 24, 32):
        m = RawDenoiseUNet(width=w)
        p, mac = count_params(m), count_macs(m)
        per_sensor_mp = mac / (256 * 256 * 4) * 1e6  # 256x256 packed = 512x512 photosites
        print(f"width {w}: {p / 1e6:.2f} M params, fp16 {p * 2 / 1e6:.1f} MB, "
              f"{per_sensor_mp / 1e9:.1f} GMAC per sensor MP, {per_sensor_mp * 24 / 1e12:.2f} TMAC per 24 MP")
