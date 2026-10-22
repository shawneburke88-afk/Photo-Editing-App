# Test photo for the Object select check (docs/PHASE3.md Part 27)

`astronaut.png` (512 × 512, 8-bit RGB, 791,555 bytes, SHA-256
`88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`): NASA astronaut Eileen Collins, committed unchanged
from scikit-image v0.24.0 `skimage/data/astronaut.png`. scikit-image's data README says of it: "No known copyright
restrictions, released into the public domain." Source: https://flic.kr/p/r9qvLn (NASA).

It is the photo the AI masks candidate check (MASKS_PREP.md, GitHub Actions run 39653265084) ran SAM 2.1 Hiera Tiny on,
with the point (110, 330) on the suit: the "AI models" workflow's `sam-check` task uses the same photo and point, so its
results can be compared with that run's.
