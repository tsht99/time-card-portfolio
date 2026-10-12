#!/usr/bin/env python3
"""Drive the installed Drizzle Kit's interactive select menus in a PTY."""
# cspell:ignore killpg waitpid WNOHANG
import json
import os
import pty
import re
import select
import sys
import time
import errno
import signal
import tty

PROMPT = re.compile(r"Is .+? created or renamed from another .+?\?")
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
OPTION = re.compile(r"\b(?:create|rename)\s+[a-z][a-z _-]*$", re.I)


def main():
    mode = sys.argv[1]
    option_index = int(sys.argv[2]) if mode == "select" else None
    command = sys.argv[3:]
    pid, master = pty.fork()
    if pid == 0:
        tty.setraw(0)
        os.execvp(command[0], command)

    os.set_blocking(master, False)
    output = ""
    selected = False
    accepted_at = 0
    prompt_seen = False
    second_prompt = False
    options = []
    deadline = time.monotonic() + 30
    status = None
    def terminate_group():
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(master, 16384).decode("utf-8", errors="replace")
            except (OSError, BlockingIOError) as error:
                if isinstance(error, OSError) and error.errno == errno.EIO:
                    break
                continue
            output += chunk
            clean = ANSI.sub("", output).replace("\r", "\n")
            prompts = list(PROMPT.finditer(clean))
            if prompts and not prompt_seen:
                prompt_seen = True
                time.sleep(0.12)
                try:
                    output += os.read(master, 16384).decode("utf-8", errors="replace")
                except (OSError, BlockingIOError):
                    pass
                clean = ANSI.sub("", output).replace("\r", "\n")
                prompts = list(PROMPT.finditer(clean))
                prompt = prompts[-1]
                prompt_block = clean[prompt.end():]
                options = list(dict.fromkeys(
                    line.strip() for line in prompt_block.splitlines()
                    if OPTION.search(line)
                ))
                if mode == "probe" or not options or option_index >= len(options):
                    terminate_group()
                else:
                    os.write(master, b"\x1b[B" * option_index)
                    time.sleep(0.08)
                    try:
                        output += os.read(master, 16384).decode("utf-8", errors="replace")
                    except (OSError, BlockingIOError):
                        pass
                    os.write(master, b"\r")
                    selected = True
                    accepted_at = len(output)
            elif selected and PROMPT.search(ANSI.sub("", output[accepted_at:])):
                # One selected decision is the entire supported interactive contract.
                second_prompt = True
                terminate_group()
                selected = False
        try:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                break
        except ChildProcessError:
            break
    else:
        terminate_group()

    if status is None:
        for _ in range(20):
            try:
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    break
            except ChildProcessError:
                status = 1 << 8
                break
            time.sleep(0.05)
        else:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                _, status = os.waitpid(pid, 0)
            except ChildProcessError:
                status = 1 << 8
    try:
        os.close(master)
    except OSError:
        pass
    print(json.dumps({
        "promptSeen": prompt_seen,
        "options": options,
        "secondPrompt": second_prompt,
        "exitCode": os.waitstatus_to_exitcode(status),
        "transcript": ANSI.sub("", output).replace("\r", "\n"),
    }))


if __name__ == "__main__":
    main()
