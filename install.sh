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
  install_output=$("$installer" install --json "$@" 2>&1)
  install_status=$?
  set -e
  printf '%s\n' "$install_output"
  install_code=$(
    printf '%s\n' "$install_output" |
      /usr/bin/sed -n 's/.*"code"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
      /usr/bin/tail -n 1
  )
}

fail_install() {
  if [ "$install_status" -ne 0 ]; then
    exit "$install_status"
  fi
  exit 1
}

install_ready=false
wait_for_restart=false

run_install
case "$install_code" in
  INSTALL_OK | INSTALL_ALREADY_CURRENT)
    if [ "$install_status" -ne 0 ]; then
      fail_install
    fi
    install_ready=true
    ;;
  INSTALL_RESTART_PENDING)
    wait_for_restart=true
    ;;
  INSTALL_RESTART_REQUIRED)
    if ! { exec 3<>/dev/tty; } 2>/dev/null; then
      printf '%s\n' "Codex must restart. Run this command in an interactive Terminal." >&2
      exit 1
    fi
    printf '%s' "Goal Progress needs to restart Codex once. Restart now? [y/N] " >&3
    answer=""
    IFS= read -r answer <&3 || true
    case "$answer" in
      y | Y | yes | YES)
        run_install --restart-codex
        case "$install_code" in
          INSTALL_OK | INSTALL_ALREADY_CURRENT)
            if [ "$install_status" -ne 0 ]; then
              fail_install
            fi
            install_ready=true
            ;;
          INSTALL_RESTART_REQUIRED | INSTALL_RESTART_PENDING)
            wait_for_restart=true
            ;;
          *)
            fail_install
            ;;
        esac
        ;;
      *)
        printf '%s\n' "Installation stopped before restarting Codex." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    fail_install
    ;;
esac

if [ "$wait_for_restart" = true ]; then
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    /bin/sleep 1
    run_install
    case "$install_code" in
      INSTALL_OK | INSTALL_ALREADY_CURRENT)
        if [ "$install_status" -ne 0 ]; then
          fail_install
        fi
        install_ready=true
        break
        ;;
      INSTALL_RESTART_REQUIRED | INSTALL_RESTART_PENDING)
        ;;
      *)
        fail_install
        ;;
    esac
    attempt=$((attempt + 1))
  done
  if [ "$install_ready" != true ]; then
    printf '%s\n' "Codex did not become ready within 60 seconds." >&2
    exit 1
  fi
fi

"$installer" doctor --json
"$installer" verify --json

printf '%s\n' "Goal Progress is installed."
