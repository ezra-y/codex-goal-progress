#!/bin/sh
set -eu

asset_name="codex-goal-progress-macos-arm64.zip"
release_base_url="${GOAL_PROGRESS_RELEASE_BASE_URL:-https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download}"
curl_binary="${GOAL_PROGRESS_CURL:-/usr/bin/curl}"

if [ "$(/usr/bin/uname -s)" != "Darwin" ] || [ "$(/usr/bin/uname -m)" != "arm64" ]; then
  printf '%s\n' "Goal Progress currently supports Apple Silicon Macs only." >&2
  exit 1
fi

work_directory=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/codex-goal-progress-install.XXXXXX")
cleanup() {
  /bin/rm -rf -- "$work_directory"
}
trap cleanup EXIT HUP INT TERM

"$curl_binary" -fsSL "$release_base_url/$asset_name" -o "$work_directory/$asset_name"
"$curl_binary" -fsSL "$release_base_url/SHA256SUMS" -o "$work_directory/SHA256SUMS"
(
  cd "$work_directory"
  /usr/bin/shasum -a 256 -c SHA256SUMS
)

/usr/bin/ditto -x -k "$work_directory/$asset_name" "$work_directory/extracted"
release_directory="$work_directory/extracted/codex-goal-progress-macos-arm64"
installer="$release_directory/bin/goal-progress"
if [ ! -x "$installer" ]; then
  printf '%s\n' "The downloaded Release does not contain the Goal Progress installer." >&2
  exit 1
fi

run_install() {
  set +e
  install_output=$("$installer" install --json 2>&1)
  install_status=$?
  set -e
  printf '%s\n' "$install_output"
}

run_install
if [ "$install_status" -ne 0 ]; then
  if ! printf '%s\n' "$install_output" | /usr/bin/grep -Fq '"code":"INSTALL_RESTART_REQUIRED"'; then
    exit "$install_status"
  fi
  if ! { exec 3<>/dev/tty; } 2>/dev/null; then
    printf '%s\n' "Codex must restart. Run this command in an interactive Terminal." >&2
    exit 1
  fi
  printf '%s' "Goal Progress needs to restart Codex once. Restart now? [y/N] " >&3
  answer=""
  IFS= read -r answer <&3 || true
  case "$answer" in
    y | Y | yes | YES)
      set +e
      restart_output=$("$installer" install --json --restart-codex 2>&1)
      restart_status=$?
      set -e
      printf '%s\n' "$restart_output"
      if [ "$restart_status" -ne 0 ]; then
        exit "$restart_status"
      fi
      ;;
    *)
      printf '%s\n' "Installation stopped before restarting Codex." >&2
      exit 1
      ;;
  esac

  attempt=0
  while [ "$attempt" -lt 60 ]; do
    /bin/sleep 1
    run_install
    if [ "$install_status" -eq 0 ]; then
      break
    fi
    attempt=$((attempt + 1))
  done
  if [ "$install_status" -ne 0 ]; then
    printf '%s\n' "Codex did not become ready within 60 seconds." >&2
    exit "$install_status"
  fi
fi

"$installer" doctor --json
"$installer" verify --json

printf '%s\n' "Goal Progress is installed."
printf '%s\n' "If Codex asks you to review the Goal Progress Hook, approve it, then open a new task."
