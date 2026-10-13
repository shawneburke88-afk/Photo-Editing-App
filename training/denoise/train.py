"""Train the LightBench raw denoiser (bf16 AMP, time-based checkpoints, automatic resume).

  python train.py --data data/packed --out runs/w24 --width 24 --find-batch      # probe the batch size, then exit
  python train.py --data data/packed --out runs/w24 --width 24 --batch 16 --samples 4000000
  (run the same command again after a crash or reboot: it resumes from runs/w24/latest.pt)

Logs: runs/<name>/train.csv (loss, lr, speed, GPU temperature/clock/power) and val.csv (PSNR per held-out tile).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from dataset import Mixed, PairCrops, SyntheticCrops, ValTiles
from model import RawDenoiseUNet, count_params


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=24)
    ap.add_argument("--no-cond", action="store_true", help="ablation: no noise-level input")
    ap.add_argument("--crop", type=int, default=256, help="packed pixels (256 = 512x512 photosites)")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--samples", type=int, default=4_000_000, help="total training crops")
    ap.add_argument("--epoch-samples", type=int, default=50_000)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--min-lr", type=float, default=1e-6)
    ap.add_argument("--warmup", type=int, default=2000, help="steps")
    ap.add_argument("--p-real", type=float, default=0.7, help="share of real pairs vs synthetic noise")
    ap.add_argument("--no-synthetic", action="store_true")
    ap.add_argument("--msssim", type=float, default=0.0, help="weight of (1 - MS-SSIM), 0 = L1 only")
    ap.add_argument("--amp", choices=["bf16", "fp16", "off"], default="bf16")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--ckpt-minutes", type=float, default=20)
    ap.add_argument("--keep", type=int, default=3)
    ap.add_argument("--val-every", type=int, default=5000, help="steps")
    ap.add_argument("--max-temp", type=int, default=87, help="pause when the GPU reaches this (deg C)")
    ap.add_argument("--find-batch", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    return ap.parse_args()


# ------------------------------------------------------------------------------------------- environment


def keep_awake():
    """Stop Windows from sleeping while training (the setting lapses when the process exits)."""
    if sys.platform == "win32":
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)


class GpuMonitor:
    """Temperature, SM clock and power via NVML (nvidia-ml-py) if installed, else nvidia-smi."""

    def __init__(self):
        self.nvml = None
        try:
            import pynvml
            pynvml.nvmlInit()
            self.nvml, self.h = pynvml, pynvml.nvmlDeviceGetHandleByIndex(0)
        except Exception:  # noqa: BLE001
            pass

    def read(self) -> dict:
        try:
            if self.nvml:
                n, h = self.nvml, self.h
                return {"temp": n.nvmlDeviceGetTemperature(h, n.NVML_TEMPERATURE_GPU),
                        "sm_mhz": n.nvmlDeviceGetClockInfo(h, n.NVML_CLOCK_SM),
                        "power_w": round(n.nvmlDeviceGetPowerUsage(h) / 1000, 1)}
            out = subprocess.run(["nvidia-smi", "--query-gpu=temperature.gpu,clocks.sm,power.draw",
                                  "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
            t, c, p = (s.strip() for s in out.stdout.splitlines()[0].split(","))
            return {"temp": int(t), "sm_mhz": int(c), "power_w": float(p) if p not in ("[N/A]", "") else None}
        except Exception:  # noqa: BLE001
            return {"temp": None, "sm_mhz": None, "power_w": None}

    def cool_down(self, max_temp: int):
        r = self.read()
        if r["temp"] is not None and r["temp"] >= max_temp:
            print(f"GPU at {r['temp']} C: pausing until {max_temp - 8} C")
            while (self.read()["temp"] or 0) > max_temp - 8:
                time.sleep(15)


# ------------------------------------------------------------------------------------------ loss, metrics


def compress(x: torch.Tensor) -> torch.Tensor:
    """sqrt: roughly variance-stabilising for shot noise, so shadows count as much as highlights in the loss."""
    return torch.sqrt(torch.clamp(x, min=0.0) + 1e-6)


def loss_fn(pred, clean, mask, msssim_w: float):
    w = mask.expand_as(pred)
    l1 = (torch.abs(compress(pred) - compress(clean)) * w).sum() / w.sum().clamp(min=1)
    if msssim_w > 0:
        from pytorch_msssim import ms_ssim  # MIT
        l1 = l1 + msssim_w * (1 - ms_ssim(compress(pred).float(), compress(clean).float(), data_range=1.0))
    return l1


def psnr(pred, clean, mask, f=lambda t: t):
    w = mask.expand_as(pred)
    mse = (((f(pred) - f(clean)) ** 2) * w).sum() / w.sum().clamp(min=1)
    return float(10 * torch.log10(1.0 / mse.clamp(min=1e-12)))


# ------------------------------------------------------------------------------------------ checkpoints


def save_ckpt(out: Path, state: dict, keep: int):
    step = state["step"]
    tmp = out / "latest.pt.tmp"
    torch.save(state, tmp)
    os.replace(tmp, out / "latest.pt")  # atomic on Windows and Linux: a crash never leaves a half-written latest
    shutil.copyfile(out / "latest.pt", out / f"ckpt_{step:08d}.pt")
    old = sorted(out.glob("ckpt_*.pt"))[:-keep]
    for p in old:
        p.unlink()
    print(f"checkpoint at step {step}")


def lr_at(step: int, total: int, args) -> float:
    if step < args.warmup:
        return args.lr * (step + 1) / args.warmup
    t = (step - args.warmup) / max(1, total - args.warmup)
    return args.min_lr + 0.5 * (args.lr - args.min_lr) * (1 + math.cos(math.pi * min(t, 1.0)))


@torch.no_grad()
def ema_update(ema: torch.nn.Module, model: torch.nn.Module, decay: float = 0.999):
    for pe, pm in zip(ema.parameters(), model.parameters()):
        pe.lerp_(pm, 1 - decay)


# ------------------------------------------------------------------------------------------------- main


def find_batch(model, args, dev, dtype):
    best = None
    for bs in (4, 8, 12, 16, 24, 32, 48, 64):
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        try:
            x = torch.rand(bs, 4, args.crop, args.crop, device=dev).contiguous(memory_format=torch.channels_last)
            a = torch.full((bs, 4, 1, 1), 1e-4, device=dev)
            with torch.autocast("cuda", dtype=dtype, enabled=args.amp != "off"):
                loss = model(x, a, a * 0).float().abs().mean()
            loss.backward()
            torch.cuda.synchronize()
            peak = torch.cuda.max_memory_allocated() / 2 ** 30
            print(f"batch {bs:3d}: peak {peak:.2f} GiB")
            best = bs
        except torch.cuda.OutOfMemoryError:
            print(f"batch {bs:3d}: out of memory")
            break
        finally:
            model.zero_grad(set_to_none=True)
    free, total = torch.cuda.mem_get_info()
    print(f"largest batch that ran: {best}. Use about 75 % of it to leave room for the desktop and for "
          f"fragmentation. Device memory free/total now: {free / 2**30:.1f}/{total / 2**30:.1f} GiB")


def main():
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    dev = torch.device("cuda")
    torch.backends.cudnn.benchmark = True
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    dtype = torch.bfloat16 if args.amp == "bf16" else torch.float16

    model = RawDenoiseUNet(width=args.width, cond=not args.no_cond).to(dev).to(memory_format=torch.channels_last)
    print(f"{count_params(model) / 1e6:.2f} M parameters on {torch.cuda.get_device_name(0)} "
          f"(capability {torch.cuda.get_device_capability(0)}), torch {torch.__version__}")
    if args.find_batch:
        find_batch(model, args, dev, dtype)
        return

    ema = RawDenoiseUNet(width=args.width, cond=not args.no_cond).to(dev)
    ema.load_state_dict(model.state_dict())
    ema.requires_grad_(False)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.99), weight_decay=1e-4)
    scaler = torch.amp.GradScaler("cuda", enabled=args.amp == "fp16")  # bf16 needs no scaler
    total_steps = args.samples // args.batch
    step = 0
    if (out / "latest.pt").exists():
        st = torch.load(out / "latest.pt", map_location=dev, weights_only=False)
        model.load_state_dict(st["model"])
        ema.load_state_dict(st["ema"])
        opt.load_state_dict(st["opt"])
        scaler.load_state_dict(st["scaler"])
        step = st["step"]
        torch.set_rng_state(st["rng_cpu"])
        torch.cuda.set_rng_state(st["rng_cuda"])
        print(f"resumed at step {step} of {total_steps}")
    (out / "args.json").write_text(json.dumps(vars(args), indent=1))

    real = PairCrops(args.data, "train", args.crop, args.epoch_samples, seed=args.seed + step)
    synth = None
    if not args.no_synthetic and (Path(args.data) / "profiles.json").exists():
        profiles = json.loads((Path(args.data) / "profiles.json").read_text())
        synth = SyntheticCrops(args.data, profiles, "train", args.crop, args.epoch_samples, seed=args.seed + step + 1)
    train_set = Mixed(real, synth, args.p_real)
    loader = DataLoader(train_set, batch_size=args.batch, shuffle=False, num_workers=args.workers,
                        pin_memory=True, drop_last=True, persistent_workers=args.workers > 0,
                        prefetch_factor=4 if args.workers > 0 else None)
    val = ValTiles(args.data, "val")
    mon = GpuMonitor()
    keep_awake()

    tlog = open(out / "train.csv", "a", newline="")
    tw = csv.writer(tlog)
    if tlog.tell() == 0:
        tw.writerow(["step", "samples", "loss", "lr", "sec_per_step", "temp", "sm_mhz", "power_w", "mem_gib"])
    last_ckpt, t0, run_loss, n_loss = time.time(), time.time(), 0.0, 0

    def state():
        return {"model": model.state_dict(), "ema": ema.state_dict(), "opt": opt.state_dict(),
                "scaler": scaler.state_dict(), "step": step, "args": vars(args),
                "rng_cpu": torch.get_rng_state(), "rng_cuda": torch.cuda.get_rng_state()}

    try:
        while step < total_steps:
            for batch in loader:
                if step >= total_steps:
                    break
                for g in opt.param_groups:
                    g["lr"] = lr_at(step, total_steps, args)
                noisy = batch["noisy"].to(dev, non_blocking=True).contiguous(memory_format=torch.channels_last)
                clean = batch["clean"].to(dev, non_blocking=True)
                mask = batch["mask"].to(dev, non_blocking=True)
                a, b = batch["a"].to(dev), batch["b"].to(dev)
                with torch.autocast("cuda", dtype=dtype, enabled=args.amp != "off"):
                    pred = model(noisy, a, b)
                loss = loss_fn(pred.float(), clean, mask, args.msssim)
                opt.zero_grad(set_to_none=True)
                scaler.scale(loss).backward()
                scaler.unscale_(opt)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(opt)
                scaler.update()
                ema_update(ema, model)
                step += 1
                run_loss += float(loss)
                n_loss += 1

                if step % 200 == 0:
                    g = mon.read()
                    dt = (time.time() - t0) / 200
                    tw.writerow([step, step * args.batch, run_loss / n_loss, opt.param_groups[0]["lr"], round(dt, 4),
                                 g["temp"], g["sm_mhz"], g["power_w"],
                                 round(torch.cuda.max_memory_allocated() / 2 ** 30, 2)])
                    tlog.flush()
                    eta_h = dt * (total_steps - step) / 3600
                    print(f"step {step}/{total_steps} loss {run_loss / n_loss:.5f} {dt * 1000:.0f} ms/step "
                          f"GPU {g['temp']} C {g['sm_mhz']} MHz {g['power_w']} W  ETA {eta_h:.1f} h")
                    run_loss, n_loss, t0 = 0.0, 0, time.time()
                    mon.cool_down(args.max_temp)
                if step % args.val_every == 0:
                    validate(ema, val, dev, out, step)
                if time.time() - last_ckpt > args.ckpt_minutes * 60:
                    save_ckpt(out, state(), args.keep)
                    last_ckpt = time.time()
    except KeyboardInterrupt:
        print("interrupted: saving")
    save_ckpt(out, state(), args.keep)
    validate(ema, val, dev, out, step)
    tlog.close()


@torch.no_grad()
def validate(model, val, dev, out: Path, step: int):
    model.eval()
    rows = []
    for i in range(len(val)):
        s = val[i]
        x, c, m = (s[k][None].to(dev) for k in ("noisy", "clean", "mask"))
        y = model(x, s["a"][None].to(dev), s["b"][None].to(dev))
        rows.append([step, s["name"], psnr(x, c, m), psnr(y, c, m), psnr(y, c, m, compress)])
    model.train()
    if not rows:
        return
    new = not (out / "val.csv").exists()
    with open(out / "val.csv", "a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["step", "tile", "psnr_noisy_lin", "psnr_out_lin", "psnr_out_sqrt"])
        w.writerows(rows)
    print(f"val step {step}: linear PSNR noisy {np.mean([r[2] for r in rows]):.2f} dB -> "
          f"{np.mean([r[3] for r in rows]):.2f} dB over {len(rows)} tiles")


if __name__ == "__main__":  # required on Windows: DataLoader workers re-import this module
    main()
