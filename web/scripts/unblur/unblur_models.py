"""Unblur spike (docs/UNBLUR_SPIKE.md): the two candidates as PyTorch modules ready for ONNX export.

MISC Filter (github.com/ChengxuLiu/MISCFilter, MIT) is built with the authors' own code at a pinned commit, with three
changes that keep the arithmetic and make it exportable and runnable without a GPU:

1. Its filter (`models/MISCKernel_cuda.py`, a CuPy CUDA kernel) is ported to PyTorch (`misc_kernel`): per output pixel,
   49 taps, each a bilinear sample at a learned offset, multiplied by the separable kernels and the softmax weight. The
   port keeps the CUDA code's clamping exactly (the position and the four neighbours are clamped separately, so samples
   past the edge count twice). `misc_kernel_literal` is a line-by-line NumPy transcription of the CUDA source used only
   to check the port on random inputs.
2. DO-Conv (`DOConv2d`, the training-time over-parameterised convolution) is folded into a plain convolution with the
   weight its forward computes (D + D_diag combined with W): the same weight, computed once.
3. The FFT residual blocks (`ResBlock_do_fft_bench`: rfft2, two 1x1 convolutions, irfft2) export as ONNX DFT nodes
   (opset 17) through a symbolic function; PyTorch still runs torch.fft. The inverse rebuilds the full spectrum from
   the one-sided half (conjugate mirror) and keeps the real part, which is what irfft2 computes (the imaginary parts of
   the DC and Nyquist bins drop out).

Only the network's final, full-resolution output is exported (the two coarser outputs feed the training loss only).
The in-place `out_norm[out_norm.abs() < 0.01] = 1.0` becomes a `where` (same values).

NAFNet (github.com/megvii-research/NAFNet, MIT) is built with the authors' code; its LayerNorm2d (a custom autograd
Function) runs as the same formula in plain operations, and NAFNetLocal's local pooling (TLC, used by the authors' GoPro
test) is kept.
"""
import importlib
import logging
import math
import os
import sys
import types

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


# ----------------------------------------------------------------------------------------------------------- MISC

def _stub_cupy():
    if "cupy" in sys.modules:
        return
    cp = types.ModuleType("cupy")
    cp.memoize = lambda **kw: (lambda f: f)
    cp.cuda = types.SimpleNamespace(compile_with_cache=None)
    sys.modules["cupy"] = cp


def import_misc(repo):
    """The authors' modules (models.MISCFilterNet, models.layers) from a checkout at `repo`."""
    _stub_cupy()
    import torch._jit_internal as ji
    if not hasattr(ji, "Optional"):
        import typing
        ji.Optional = typing.Optional
    if repo not in sys.path:
        sys.path.insert(0, repo)
    net = importlib.import_module("models.MISCFilterNet")
    return net


def load_state(path):
    try:
        ck = torch.load(path, map_location="cpu", weights_only=True)
    except Exception:  # noqa: BLE001 - the authors' checkpoints may hold non-tensor entries
        ck = torch.load(path, map_location="cpu", weights_only=False)
    sd = ck.get("state_dict", ck.get("params", ck)) if isinstance(ck, dict) else ck
    if isinstance(sd, dict) and "params" in sd and not any(isinstance(v, torch.Tensor) for v in sd.values()):
        sd = sd["params"]
    return {(k[7:] if k.startswith("module.") else k): v for k, v in sd.items()}


def misc_kernel(inp, vertical, horizontal, offset_x, offset_y, weight):
    """PyTorch port of kernel_Kernel_updateOutput (MISCKernel_cuda.py). inp [B,C,H+6,W+6] (replication-padded);
    vertical/horizontal [B,7,H,W]; offset_x/offset_y/weight [B,49,H,W]. Returns [B,C,H,W]."""
    B, C, Hin, Win = inp.shape
    K = vertical.shape[1]
    H, W = vertical.shape[2], vertical.shape[3]
    half = (K - 1) // 2
    dt = inp.dtype
    ys = torch.arange(H, dtype=dt, device=inp.device).view(1, 1, H, 1)
    xs = torch.arange(W, dtype=dt, device=inp.device).view(1, 1, 1, W)
    flat = inp.reshape(B, C, Hin * Win)
    out = None
    for fy in range(K):
        for fx in range(K):
            k = fy * K + fx
            # CUDA: delta_x = offset_y[k], delta_y = offset_x[k]; position = delta + pixel + tap - (K-1)/2 + 1
            ux = offset_y[:, k:k + 1] + xs + float(fx - half + 1)
            uy = offset_x[:, k:k + 1] + ys + float(fy - half + 1)
            px = ux.clamp(0, Win - 1)
            py = uy.clamp(0, Hin - 1)
            left = torch.floor(ux)
            top = torch.floor(uy)
            right = (left + 1).clamp(0, Win - 1)
            bottom = (top + 1).clamp(0, Hin - 1)
            left = left.clamp(0, Win - 1)
            top = top.clamp(0, Hin - 1)
            wl = 1 + (left - px)
            wr = 1 - (right - px)
            wt = 1 + (top - py)
            wb = 1 - (bottom - py)

            def tap(r, c):
                # float index, expanded over channels before the cast (an int64 Expand has no WebGPU kernel)
                idx = (r * Win + c).reshape(B, 1, H * W).expand(B, C, H * W).long()
                return torch.gather(flat, 2, idx).reshape(B, C, H, W)

            val = tap(top, left) * wl * wt + tap(top, right) * wr * wt + tap(bottom, left) * wl * wb + tap(bottom, right) * wr * wb
            term = val * vertical[:, fy:fy + 1] * horizontal[:, fx:fx + 1] * weight[:, k:k + 1]
            out = term if out is None else out + term
    return out


def misc_kernel_literal(inp, vertical, horizontal, offset_x, offset_y, weight):
    """Line-by-line NumPy transcription of kernel_Kernel_updateOutput (float32 arithmetic), for checking the port."""
    inp, vertical, horizontal, offset_x, offset_y, weight = (np.asarray(t, np.float32) for t in (inp, vertical, horizontal, offset_x, offset_y, weight))
    S0, S1, S2, S3 = inp.shape[0], inp.shape[1], vertical.shape[2], vertical.shape[3]
    Kv, Kh = vertical.shape[1], horizontal.shape[1]
    Hin, Win = inp.shape[2], inp.shape[3]
    out = np.zeros((S0, S1, S2, S3), np.float32)
    f32 = np.float32
    for n in range(S0):
        for d in range(S1):
            for y in range(S2):
                for x in range(S3):
                    acc = f32(0)
                    for fy in range(Kv):
                        for fx in range(Kh):
                            dx = offset_y[n, fy * Kv + fx, y, x]
                            dy = offset_x[n, fy * Kh + fx, y, x]
                            pxu = f32(f32(f32(dx + f32(x)) + f32(fx)) - f32((Kh - 1) // 2)) + f32(1)
                            pyu = f32(f32(f32(dy + f32(y)) + f32(fy)) - f32((Kv - 1) // 2)) + f32(1)
                            px = min(max(pxu, f32(0)), f32(Win - 1))
                            py = min(max(pyu, f32(0)), f32(Hin - 1))
                            left = int(math.floor(pxu))
                            right = left + 1
                            left = min(max(left, 0), Win - 1)
                            right = min(max(right, 0), Win - 1)
                            top = int(math.floor(pyu))
                            bottom = top + 1
                            top = min(max(top, 0), Hin - 1)
                            bottom = min(max(bottom, 0), Hin - 1)
                            v = (inp[n, d, top, left] * f32(1 + (left - px)) * f32(1 + (top - py))
                                 + inp[n, d, top, right] * f32(1 - (right - px)) * f32(1 + (top - py))
                                 + inp[n, d, bottom, left] * f32(1 + (left - px)) * f32(1 - (bottom - py))
                                 + inp[n, d, bottom, right] * f32(1 - (right - px)) * f32(1 - (bottom - py)))
                            acc = f32(acc + f32(v * vertical[n, fy, y, x] * horizontal[n, fx, y, x] * weight[n, Kv * fy + fx, y, x]))
                    out[n, d, y, x] = acc
    return out


class RFFT2(torch.autograd.Function):
    """rfft2 (norm 'backward') as [..., H, W//2+1, 2] (real, imaginary)."""

    @staticmethod
    def forward(ctx, x):
        y = torch.fft.rfft2(x, norm="backward")
        return torch.stack([y.real, y.imag], -1)

    @staticmethod
    def symbolic(g, x):
        xu = g.op("Unsqueeze", x, g.op("Constant", value_t=torch.tensor([4], dtype=torch.int64)))
        y = g.op("DFT", xu, axis_i=3, onesided_i=1)
        return g.op("DFT", y, axis_i=2, onesided_i=0)


class IRFFT2(torch.autograd.Function):
    """irfft2 (norm 'backward', even W) of [..., H, W//2+1, 2] -> [..., H, W]."""

    @staticmethod
    def forward(ctx, y):
        return torch.fft.irfft2(torch.complex(y[..., 0], y[..., 1]), s=(y.shape[-3], 2 * (y.shape[-2] - 1)), norm="backward")

    @staticmethod
    def symbolic(g, y):
        z = g.op("DFT", y, axis_i=2, inverse_i=1, onesided_i=0)
        # The mirrored half: bins K-2 .. 1, conjugated.
        shape = g.op("Shape", z)
        k = g.op("Gather", shape, g.op("Constant", value_t=torch.tensor(3, dtype=torch.int64)), axis_i=0)
        start = g.op("Sub", k, g.op("Constant", value_t=torch.tensor(2, dtype=torch.int64)))
        idx = g.op("Range", start, g.op("Constant", value_t=torch.tensor(0, dtype=torch.int64)), g.op("Constant", value_t=torch.tensor(-1, dtype=torch.int64)))
        tail = g.op("Gather", z, idx, axis_i=3)
        tail = g.op("Mul", tail, g.op("Constant", value_t=torch.tensor([1.0, -1.0], dtype=torch.float32)))
        full = g.op("Concat", z, tail, axis_i=3)
        x = g.op("DFT", full, axis_i=3, inverse_i=1, onesided_i=0)
        re = g.op("Gather", x, g.op("Constant", value_t=torch.tensor(0, dtype=torch.int64)), axis_i=4)
        return re


class FFTPart(nn.Module):
    """ResBlock_do_fft_bench's frequency branch: rfft2 -> [re, im] -> two 1x1 convolutions -> irfft2."""

    def __init__(self, main_fft):
        super().__init__()
        self.main_fft = main_fft

    def forward(self, x):
        y = RFFT2.apply(x)  # B,C,H,K,2
        y_f = torch.cat([y[..., 0], y[..., 1]], dim=1)
        y = self.main_fft(y_f)
        y_real, y_imag = torch.chunk(y, 2, dim=1)
        return IRFFT2.apply(torch.stack([y_real, y_imag], -1))


class ResBlockExport(nn.Module):
    def __init__(self, blk):
        super().__init__()
        self.main = blk.main
        self.fft = FFTPart(blk.main_fft)

    def forward(self, x):
        return self.main(x) + x + self.fft(x)


def fold_doconv(net):
    """Every DOConv2d -> nn.Conv2d with the weight DOConv2d.forward computes (exact)."""
    n = 0
    for mod in list(net.modules()):
        for name, ch in list(mod.named_children()):
            if type(ch).__name__ not in ("DOConv2d", "DOConv2d_eval"):
                continue
            with torch.no_grad():
                M, N = ch.kernel_size
                shape = (ch.out_channels, ch.in_channels // ch.groups, M, N)
                if type(ch).__name__ == "DOConv2d_eval":
                    w = ch.W
                elif M * N > 1:
                    D = ch.D + ch.D_diag
                    W = torch.reshape(ch.W, (ch.out_channels // ch.groups, ch.in_channels, ch.D_mul))
                    w = torch.reshape(torch.einsum("ims,ois->oim", D, W), shape)
                else:
                    w = torch.reshape(ch.W, shape)
                assert ch.padding_mode == "zeros" and not getattr(ch, "simam", False)
                conv = nn.Conv2d(ch.in_channels, ch.out_channels, (M, N), stride=ch.stride, padding=ch.padding,
                                 dilation=ch.dilation, groups=ch.groups, bias=ch.bias is not None)
                conv.weight.copy_(w)
                if ch.bias is not None:
                    conv.bias.copy_(ch.bias)
            setattr(mod, name, conv)
            n += 1
    return n


class FlowWarp(nn.Module):
    """MISCFilterNet.flow_warp (grid_sample, bilinear, zeros, align_corners=True)."""

    def forward(self, x, flow):
        _, _, h, w = x.size()
        gy, gx = torch.meshgrid(torch.arange(0, h, dtype=x.dtype), torch.arange(0, w, dtype=x.dtype), indexing="ij")
        grid = torch.stack((gx, gy), 2)
        gf = grid + flow
        gfx = 2.0 * gf[:, :, :, 0] / max(w - 1, 1) - 1.0
        gfy = 2.0 * gf[:, :, :, 1] / max(h - 1, 1) - 1.0
        return F.grid_sample(x, torch.stack((gfx, gfy), dim=3), mode="bilinear", padding_mode="zeros", align_corners=True)


class MiscKernel(nn.Module):
    def forward(self, *a):
        return misc_kernel(*a)


class MiscExport(nn.Module):
    """MISCKernelNet's inference path (the full-resolution output only), with the authors' modules (folded)."""

    def __init__(self, net):
        super().__init__()
        self.n = net
        self.dim = net.dim
        for enc in list(net.Encoder) + list(net.Decoder):
            for i, blk in enumerate(enc.layers):
                enc.layers[i] = ResBlockExport(blk)
        self.warp = FlowWarp()
        self.kernel = MiscKernel()

    def forward(self, x):
        n = self.n
        x_2 = F.interpolate(x, scale_factor=0.5)
        x_4 = F.interpolate(x_2, scale_factor=0.5)
        z2 = n.SCM2(x_2)
        z4 = n.SCM1(x_4)
        x_ = n.feat_extract[0](x)
        res1 = n.Encoder[0](x_)
        z = n.feat_extract[1](res1)
        z = n.FAM2(z, z2)
        res2 = n.Encoder[1](z)
        z = n.feat_extract[2](res2)
        z = n.FAM1(z, z4)
        z = n.Encoder[2](z)
        z12 = F.interpolate(res1, scale_factor=0.5)
        z21 = F.interpolate(res2, scale_factor=2)
        z42 = F.interpolate(z, scale_factor=2)
        z41 = F.interpolate(z42, scale_factor=2)
        res2 = n.AFFs[1](z12, res2, z42)
        res1 = n.AFFs[0](res1, z21, z41)
        z = n.Decoder[0](z)
        # scale 3 (1/4): only the flow, its mask and the warped features reach the output
        s3_flow = n.KernelPredictFlow[0](z)
        s3_mask = torch.sigmoid(n.KernelPredictFlowMask[0](z))
        zx4 = torch.cat([z, x_4], 1)
        f0, _ = torch.split(self.warp(zx4, s3_flow.permute(0, 2, 3, 1)), self.dim * 4, dim=1)
        f1, _ = torch.split(self.warp(zx4, -s3_flow.permute(0, 2, 3, 1)), self.dim * 4, dim=1)
        z = torch.cat([z, f0 * s3_mask + f1 * (1 - s3_mask)], 1)
        z = n.feat_extract[3](z)
        z = torch.cat([z, res2], dim=1)
        z = n.Convs[0](z)
        z = n.Decoder[1](z)
        # scale 2 (1/2)
        s2_flow = n.KernelPredictFlow[1](z) + n.flowup(s3_flow) * 2
        s2_mask = torch.sigmoid(n.KernelPredictFlowMask[1](z))
        zx2 = torch.cat([z, x_2], 1)
        f0, _ = torch.split(self.warp(zx2, s2_flow.permute(0, 2, 3, 1)), self.dim * 2, dim=1)
        f1, _ = torch.split(self.warp(zx2, -s2_flow.permute(0, 2, 3, 1)), self.dim * 2, dim=1)
        z = torch.cat([z, f0 * s2_mask + f1 * (1 - s2_mask)], 1)
        z = n.feat_extract[4](z)
        z = torch.cat([z, res1], dim=1)
        z = n.Convs[1](z)
        z = n.Decoder[2](z)
        # scale 1 (full): the filter
        s1_flow = n.KernelPredictFlow[2](z) + n.flowup(s2_flow) * 2
        s1_mask = torch.sigmoid(n.KernelPredictFlowMask[2](z))
        zx = torch.cat([z, x], 1)
        f0, x0 = torch.split(self.warp(zx, s1_flow.permute(0, 2, 3, 1)), self.dim, dim=1)
        f1, x1 = torch.split(self.warp(zx, -s1_flow.permute(0, 2, 3, 1)), self.dim, dim=1)
        xw = x0 * s1_mask + x1 * (1 - s1_mask)
        bias = n.KernelOutBias[2](z)
        z = torch.cat([z, f0 * s1_mask + f1 * (1 - s1_mask)], 1)
        wgt = torch.softmax(n.KernelOutWeight[2](z), dim=1)
        alpha = n.KernelOutAlpha[2](z)
        beta = n.KernelOutBeta[2](z)
        posx = n.KernelOutkernelx[2](z)
        posy = n.KernelOutkernely[2](z)
        padded = n.modulePad(torch.cat([xw, torch.ones_like(xw[:, :1])], 1))
        out = self.kernel(padded, posx, posy, alpha, beta, wgt)
        norm = out[:, -1:, :, :]
        norm = torch.where(norm.abs() < 0.01, torch.ones_like(norm), norm)
        return out[:, :-1, :, :] / norm + bias


def build_misc(repo, weights):
    """(reference, export): the authors' MISCKernelNet with its checkpoint and the ported filter (eager PyTorch,
    original forward) and the export module (folded DO-Conv, DFT symbolic). Both on the CPU, eval mode."""
    mod = import_misc(repo)
    sd = load_state(weights)
    ref = mod.MISCKernelNet(inference=False)
    missing, unexpected = ref.load_state_dict(sd, strict=True), None
    ref.moduleKernel = misc_kernel
    ref.eval()
    exp = mod.MISCKernelNet(inference=False)
    exp.load_state_dict(sd, strict=True)
    folded = fold_doconv(exp)
    exp = MiscExport(exp).eval()
    info = {"tensorsInCheckpoint": len(sd), "paramsCheckpoint": int(sum(v.numel() for v in sd.values())),
            "paramsExport": int(sum(p.numel() for p in exp.parameters())), "doconvFolded": folded}
    return ref, exp, info


def misc_reference_forward(ref, x):
    with torch.no_grad():
        outs, _ = ref(x)
    return outs[0]


# --------------------------------------------------------------------------------------------------------- NAFNet

def import_nafnet(repo):
    if "basicsr" not in sys.modules:
        for name, path in [("basicsr", "basicsr"), ("basicsr.models", "basicsr/models"), ("basicsr.models.archs", "basicsr/models/archs")]:
            m = types.ModuleType(name)
            m.__path__ = [os.path.join(repo, path)]
            sys.modules[name] = m
        u = types.ModuleType("basicsr.utils")
        u.get_root_logger = lambda *a, **k: logging.getLogger("basicsr")
        sys.modules["basicsr.utils"] = u
    arch = importlib.import_module("basicsr.models.archs.NAFNet_arch")
    util = importlib.import_module("basicsr.models.archs.arch_util")

    def ln_forward(self, x):  # LayerNormFunction.forward, in plain operations
        C = x.shape[1]
        mu = x.mean(1, keepdim=True)
        var = (x - mu).pow(2).mean(1, keepdim=True)
        y = (x - mu) / (var + self.eps).sqrt()
        return self.weight.view(1, C, 1, 1) * y + self.bias.view(1, C, 1, 1)

    util.LayerNorm2d.forward = ln_forward
    return arch


def build_nafnet(repo, weights, local=True, width=64):
    """NAFNet-GoPro-width64 / REDS-width64 as the authors' test options build it (NAFNetLocal, TLC, train size 256)."""
    arch = import_nafnet(repo)
    kw = dict(img_channel=3, width=width, middle_blk_num=1, enc_blk_nums=[1, 1, 1, 28], dec_blk_nums=[1, 1, 1, 1])
    net = arch.NAFNetLocal(**kw) if local else arch.NAFNet(**kw)
    sd = load_state(weights)
    net.load_state_dict(sd, strict=True)
    net.eval()
    return net, {"tensorsInCheckpoint": len(sd), "params": int(sum(p.numel() for p in net.parameters())), "local": local}
