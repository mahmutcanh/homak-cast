"""Synthesizes sound effects + soft pad from out/events.json, optionally mixes voiceover (vo/*.wav).
Usage: python make_audio.py  -> out/audio.wav"""
import json, os, glob, wave
import numpy as np

SR = 44100
data = json.load(open('out/events.json'))
dur, events = data['duration'], data['events']
mix = np.zeros(int(SR * (dur + 1)), dtype=np.float64)

def t_(n): return np.arange(int(SR * n)) / SR
def env(n, a=0.005, r=0.2):
    x = t_(n); e = np.minimum(1, x / a) * np.exp(-x / r); return e

def whoosh():
    n = 0.9; x = t_(n); noise = np.random.default_rng(1).standard_normal(len(x))
    # moving band-pass via cumulative smoothing
    k = 40; sm = np.convolve(noise, np.ones(k) / k, mode='same')
    e = np.sin(np.pi * np.clip(x / n, 0, 1)) ** 2
    sweep = np.sin(2 * np.pi * (200 * x + 900 * x ** 2))
    return (0.35 * sm * 3 + 0.12 * sweep) * e * 0.55

def pop():
    x = t_(0.25); f = 520 * np.exp(-x * 9) + 180
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(0.25, 0.002, 0.07) * 0.5

def tick():
    x = t_(0.12)
    return (np.sin(2 * np.pi * 1800 * x) * 0.5 + np.sin(2 * np.pi * 2700 * x) * 0.25) * env(0.12, 0.001, 0.02) * 0.45

def chime():
    x = t_(2.2); out = np.zeros_like(x)
    for i, f in enumerate([880, 1108.7, 1318.5, 1760]):
        d = int(SR * 0.12 * i); s = np.sin(2 * np.pi * f * x[:len(x) - d]) * np.exp(-x[:len(x) - d] * 2.2)
        out[d:] += s * 0.22
    return out

SFX = {'whoosh': whoosh(), 'pop': pop(), 'tick': tick(), 'chime': chime()}
for at, name in events:
    s = SFX[name]; i = int(at * SR); mix[i:i + len(s)] += s[:len(mix) - i]

# soft ambient pad (A minor-ish), slow swell, low level
x = np.arange(len(mix)) / SR
pad = sum(np.sin(2 * np.pi * f * x + p) * g for f, p, g in [(110, 0, .5), (164.8, 1, .35), (220, 2, .3), (261.6, 3, .2)])
pad *= (0.75 + 0.25 * np.sin(2 * np.pi * x / 6.0)) * 0.05
pad *= np.minimum(1, x / 2) * np.minimum(1, np.maximum(0, (dur - x)) / 2.5)
mix += pad

# optional voiceover: vo/NN.wav placed at the scene starts listed in vo/starts.json
vo_dir = 'vo'
if os.path.isdir(vo_dir) and os.path.exists(f'{vo_dir}/starts.json'):
    starts = json.load(open(f'{vo_dir}/starts.json'))
    for name, at in starts.items():
        p = f'{vo_dir}/{name}.wav'
        if not os.path.exists(p): continue
        with wave.open(p) as w:
            raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
            if w.getnchannels() == 2: raw = raw.reshape(-1, 2).mean(axis=1)
            if w.getframerate() != SR:
                raw = np.interp(np.arange(0, len(raw), w.getframerate() / SR), np.arange(len(raw)), raw)
        i = int(at * SR); seg = raw[:len(mix) - i] * 0.95
        mix[i:i + len(seg)] *= 0.55  # duck music/sfx under the voice
        mix[i:i + len(seg)] += seg

mix[:int(dur * SR)] *= 1.0
peak = np.max(np.abs(mix)); mix = mix / peak * 0.89 if peak > 0 else mix
mix = mix[:int(dur * SR)]
pcm = (mix * 32767).astype(np.int16)
with wave.open('out/audio.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('audio ok', dur, 'sec', len(events), 'events')
