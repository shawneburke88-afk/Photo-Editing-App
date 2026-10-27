# Test photo for the Object select check (docs/PHASE3.md Part 27)

`astronaut.png` (512 × 512, 8-bit RGB, 791,555 bytes, SHA-256
`88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`): NASA astronaut Eileen Collins, committed unchanged
from scikit-image v0.24.0 `skimage/data/astronaut.png`. scikit-image's data README says of it: "No known copyright
restrictions, released into the public domain." Source: https://flic.kr/p/r9qvLn (NASA).

It is the photo the AI masks candidate check (MASKS_PREP.md, GitHub Actions run 39653265084) ran SAM 2.1 Hiera Tiny on,
with the point (110, 330) on the suit: the "AI models" workflow's `sam-check` task uses the same photo and point, so its
results can be compared with that run's.

# Test photo for the Sky check (docs/PHASE3.md Part 29)

`rocket.jpg` (640 × 427, 8-bit RGB JPEG, 112,525 bytes, SHA-256
`c2dd0de7c538df8d111e479619b129464d0269d0ae5fd18ca91d33a7fdfea95c`): SpaceX's launch of DSCOVR on a Falcon 9 from Launch
Complex 40, Cape Canaveral, with trees against the sky at the bottom; committed unchanged from scikit-image v0.24.0
`skimage/data/rocket.jpg` (the same bytes as the AI masks candidate check's copy on the masks-prep branch). scikit-image
says of it (`skimage/data/_fetchers.py`, `rocket()`): "The image was captured by SpaceX and released in the public
domain". Source: https://www.flickr.com/photos/spacexphotos/16511594820/ (SpaceX).

The AI masks candidate check (MASKS_PREP.md, GitHub Actions run 39653265084) ran EfficientViT-Seg B1 (ADE20K) on it,
stretched to 512 × 512: the sky was the model's answer for 0.898 of the cells. The "AI models" workflow's `sky-check`
runs the app's own Sky code on it (and on `astronaut.png`, which has no sky).
