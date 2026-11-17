# MAESTRO

**Take the podium.** A web game that makes you the conductor of a symphony orchestra. Your camera watches your baton, and the orchestra follows it: its tempo, its dynamics, its every entrance. Made to bring people closer to classical music.

**Play:** https://ltmtms.github.io/maestro/ (phone, iPad or desktop; HTTPS is needed for the camera)

## How to play

1. Pick a piece, and the hand you conduct with.
2. Hold a baton: a real one, a chopstick or a pencil. Light-coloured against a dark background is easiest for the camera. No baton? Your hand works too.
3. Stand so the camera sees your upper body.
4. **Start like a real conductor:** a preparatory upbeat ↑, then the downbeat ↓. The time between them sets the tempo.
5. **Follow the golden arrows.** They trace the real beat patterns, and a light travels along each arrow to land on the beat:

   | Time | Pattern |
   | --- | --- |
   | 4/4 | 1 ↓ · 2 ← · 3 → · 4 ↑ |
   | 3/4 | 1 ↓ · 2 → · 3 ↑ |
   | 2/4 | 1 ↓ · 2 ↑ |

6. **Size is volume:** small gestures for *piano*, big ones for *forte*. Match the marking on the right-hand meter. Soft playing also sounds darker, as it does in a real orchestra.
7. **The orchestra follows you.** Speed up and it speeds up. Stop conducting and it hesitates, then waits at the next bar for your downbeat.

Each beat is judged on timing (40%), direction (40%) and dynamics (20%): **BRAVISSIMO · BRAVO · BENE · ANCORA**. At the curtain call you get a rank, from **S+++ Maestro** through S++ Virtuoso, S+ Principal Conductor, S Guest Conductor, A Assistant Conductor and B Conservatory Student, down to C Music Lover, plus a little history of the piece.

## Programme

| Piece | Level | Time | Tempo |
| --- | --- | --- | --- |
| Pachelbel: Canon in D | Beginner | 4/4 | Andante, ♩ = 66 |
| Beethoven: Symphony No. 9, "Ode to Joy" | Intermediate | 4/4 | Allegro assai, ♩ = 104 |
| Strauss II: The Blue Danube | Advanced | 3/4 | Tempo di valse, ♩ = 144 |
| Your own MP3 | | 4/4 | the recording keeps its own tempo; your gestures shape its energy |

All three works are in the public domain. The arrangements are simplified versions written for this game.

## How it works

| Part | Method |
| --- | --- |
| Body tracking | MediaPipe PoseLandmarker (the modern successor of PoseNet), GPU with CPU fallback, one inference per camera frame. Everything is measured in shoulder widths, so distance doesn't matter. |
| Baton detection | A pose model can't see what you hold, so the image is analysed: a patch around the hand is scanned along a fan of rays (±75° around the forearm and finger direction, then a fine 1° pass). A baton is a thin straight **ridge**, brighter or darker than both sides. Sleeves and door frames are one-sided steps and are rejected. The longest ridge starting at the fist is the baton; its end is the tip. Without one, an imaginary baton extends from the hand. Tested on synthetic frames: tip within 4–9 px, no false positives. |
| Beats (ictus) | The baton tip's path is analysed for the conductor's "click": a fast stroke that rebounds or stops. The beat time is where the stroke went furthest, which removes the camera-frame lag. Each beat carries its stroke direction (matched against the arrow) and size (dynamics). |
| Following | A variable-tempo transport schedules the score with a short look-ahead. After each beat, the tempo is re-aimed so the next beat lands where the conductor will put it, 75% of the way, a little behind the baton like a real orchestra. With no beats, the orchestra slows down, then stops and waits at the next bar. |
| Orchestra | Tone.js samplers with FluidR3 GM samples (MIT): violins, string section, cellos, double basses, flute, oboe, horns, trumpets, timpani, harp, pizzicato. Concert-hall reverb, plus a dynamics stage (gain and brightness) that follows your gestures. Self-hosted, about 4 MB. |
| Recordings | Your MP3 is analysed for beats and downbeats (the same steady-tempo grid as the [move](https://github.com/ltmtms/move) rhythm game), and its volume follows your gestures. |

Camera and music stay on your device.

## Develop

```bash
npm install
npm run dev     # also copies the MediaPipe runtime and downloads the pose model
npm run build
```

Pushes to `main` deploy to GitHub Pages (`.github/workflows/deploy-pages.yml`). Enable **Settings → Pages → Source: GitHub Actions** once.

## Credits

- Instrument samples: FluidR3 GM SoundFont © Frank Wen, MIT License, via `soundfont-for-samplers` (MIT). See `public/samples/LICENSE.txt`.
- Pose tracking: MediaPipe (Apache 2.0). Audio: Tone.js (MIT).
