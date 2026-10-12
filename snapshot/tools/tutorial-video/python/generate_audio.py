import argparse
from pathlib import Path

import numpy as np
from supertonic import TTS


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=int)
    args = parser.parse_args()

    tts = TTS(model_dir=args.model_dir, auto_download=False)
    style = tts.get_voice_style(voice_name="F1")
    np.random.seed(args.seed)
    audio, _duration = tts.synthesize(
        text=args.text,
        voice_style=style,
        total_steps=8,
        speed=1.0,
        lang="ja",
        verbose=False,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    tts.save_audio(audio, str(args.output))


if __name__ == "__main__":
    main()
