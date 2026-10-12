import argparse
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REPOSITORY = "supertone-oss-archive/supertonic-3"
MODEL_REVISION = "aafc6e32416a594460b32413efc49d7fe4ce6d46"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    snapshot_download(
        repo_id=MODEL_REPOSITORY,
        revision=MODEL_REVISION,
        local_dir=args.output,
    )


if __name__ == "__main__":
    main()
