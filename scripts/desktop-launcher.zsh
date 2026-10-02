#!/bin/zsh

set -u

readonly service_dir="/Users/dhkim/Source/AI Talent/AInsight/business-app-project/services/naver-blog-finalizer"
readonly port_path="${service_dir}/scripts/server-port"
readonly server_port="$(/usr/bin/tr -d '[:space:]' < "${port_path}" 2>/dev/null)"
readonly service_url="http://localhost:${server_port}"
readonly state_dir="/Users/dhkim/Library/Application Support/바로발행"
readonly runtime_dir="${state_dir}/runtime"
readonly runtime_manifest_path="${runtime_dir}/runtime-manifest"
readonly access_token_path="${state_dir}/access-token"
readonly access_link_path="${state_dir}/바로발행.webloc"
readonly log_dir="/Users/dhkim/Library/Logs/바로발행"
readonly log_path="${log_dir}/server.log"
readonly launcher_log_path="${log_dir}/launcher.log"
readonly launcher_lock_path="${state_dir}/launcher.lockf"
readonly job_label="com.local.naver-blog-finalizer.server"
readonly job_target="gui/${UID}/${job_label}"

node_path=""
expected_cdhash=""
submitted_job=0
background_mode=0
lock_held=0
private_paths_ready=0
local_access_token=""

for launcher_arg in "$@"; do
  case "${launcher_arg}" in
    --background) background_mode=1 ;;
    --with-launch-lock) lock_held=1 ;;
    *) exit 64 ;;
  esac
done

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
umask 077

listener_is_ours() {
  local listener_pid process_uid process_cwd
  local -a listener_pids
  listener_pids=("${(@f)$(/usr/sbin/lsof -t -nP -iTCP:"${server_port}" -sTCP:LISTEN 2>/dev/null)}")
  (( ${#listener_pids[@]} > 0 )) || return 1

  for listener_pid in "${listener_pids[@]}"; do
    process_uid="$(/bin/ps -o uid= -p "${listener_pid}" 2>/dev/null | /usr/bin/tr -d '[:space:]')"
    process_cwd="$(/usr/sbin/lsof -a -p "${listener_pid}" -d cwd -Fn 2>/dev/null \
      | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -n 1)"
    [[ "${process_uid}" == "${UID}" && "${process_cwd}" == "${service_dir}" ]] || return 1
  done
}

site_is_ready() {
  local root_status
  listener_is_ours || return 1
  /usr/bin/curl --noproxy '*' --fail --silent --show-error --connect-timeout 0.5 --max-time 1 \
    "${service_url}/baro-health.txt" 2>/dev/null \
    | /usr/bin/grep --fixed-strings --line-regexp --quiet "baro-publish-ok" || return 1
  root_status="$(/usr/bin/curl --noproxy '*' --silent --show-error --connect-timeout 0.5 --max-time 2 \
    --output /dev/null --write-out '%{http_code}' "${service_url}" 2>/dev/null)" || return 1
  [[ "${root_status}" == "200" ]]
}

write_launcher_log() {
  local message="$1"
  if (( private_paths_ready == 0 )); then
    /usr/bin/printf '%s\n' "${message}" >&2
    return
  fi
  /usr/bin/printf '%s %s\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "${message}" >>"${launcher_log_path}" 2>/dev/null || true
}

show_error() {
  local message="${1:-바로발행을 열지 못했습니다.}"
  write_launcher_log "실패: ${message}"
  if (( background_mode == 1 )); then
    return
  fi
  /usr/bin/osascript -e "display dialog \"${message}\\n\\n실행 로그: ${launcher_log_path}\\n서버 로그: ${log_path}\" buttons {\"확인\"} default button \"확인\" with icon stop" >/dev/null
}

open_site() {
  if (( background_mode == 0 )); then
    /usr/bin/open "${access_link_path}"
  fi
}

prepare_access_token() {
  local token_temp link_temp
  if [[ -e "${access_token_path}" && (-L "${access_token_path}" || ! -f "${access_token_path}" || ! -O "${access_token_path}") ]]; then
    return 1
  fi
  if [[ ! -e "${access_token_path}" ]]; then
    token_temp="$(/usr/bin/mktemp "${state_dir}/access-token.XXXXXX")" || return 1
    /usr/bin/openssl rand -hex 32 >"${token_temp}" || return 1
    /bin/chmod 400 "${token_temp}" || return 1
    /bin/mv -f "${token_temp}" "${access_token_path}" || return 1
  fi
  /bin/chmod 400 "${access_token_path}" || return 1
  local_access_token="$(/usr/bin/tr -d '[:space:]' < "${access_token_path}")" || return 1
  /usr/bin/printf '%s\n' "${local_access_token}" \
    | /usr/bin/grep --extended-regexp --quiet '^[[:xdigit:]]{64}$' || return 1

  if [[ -e "${access_link_path}" && (-L "${access_link_path}" || ! -f "${access_link_path}" || ! -O "${access_link_path}") ]]; then
    return 1
  fi
  link_temp="$(/usr/bin/mktemp "${state_dir}/access-link.XXXXXX")" || return 1
  {
    print -r -- '<?xml version="1.0" encoding="UTF-8"?>'
    print -r -- '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    print -r -- '<plist version="1.0"><dict><key>URL</key>'
    print -r -- "<string>${service_url}/#baro-token=${local_access_token}</string>"
    print -r -- '</dict></plist>'
  } >"${link_temp}" || return 1
  /bin/chmod 400 "${link_temp}" || return 1
  /bin/mv -f "${link_temp}" "${access_link_path}" || return 1
}

ensure_private_directory() {
  local directory="$1"
  if [[ -L "${directory}" || (-e "${directory}" && ! -d "${directory}") ]]; then
    return 1
  fi
  /bin/mkdir -p "${directory}" || return 1
  [[ -O "${directory}" ]] || return 1
  /bin/chmod 700 "${directory}" || return 1
}

dependencies_are_system_only() {
  local candidate="$1" dylib_listing unsafe_dependencies
  dylib_listing="$(/usr/bin/otool -L "${candidate}" 2>/dev/null)" || return 1
  unsafe_dependencies="$(/usr/bin/printf '%s\n' "${dylib_listing}" \
    | /usr/bin/awk 'NR > 1 && $1 !~ "^/usr/lib/" && $1 !~ "^/System/Library/" { print $1 }')"
  [[ -z "${unsafe_dependencies}" ]]
}

runtime_entitlements_are_minimal() {
  local candidate="$1" entitlements parsed_entitlements entry_count entitlement escaped_entitlement value
  entitlements="$(/usr/bin/codesign -d --entitlements :- "${candidate}" 2>/dev/null)" || return 1
  parsed_entitlements="$(/usr/bin/printf '%s' "${entitlements}" | /usr/bin/plutil -p - 2>/dev/null)" || return 1
  entry_count="$(/usr/bin/printf '%s\n' "${parsed_entitlements}" \
    | /usr/bin/awk '/ => / { count++ } END { print count + 0 }')"
  [[ "${entry_count}" == "3" ]] || return 1

  for entitlement in \
    com.apple.security.cs.disable-library-validation \
    com.apple.security.cs.allow-jit \
    com.apple.security.cs.allow-unsigned-executable-memory; do
    escaped_entitlement="${entitlement//./\\.}"
    value="$(/usr/bin/printf '%s' "${entitlements}" \
      | /usr/bin/plutil -extract "${escaped_entitlement}" raw -o - - 2>/dev/null)" || return 1
    [[ "${value}" == "true" ]] || return 1
  done
}

load_runtime_manifest() {
  local manifest_owner manifest_permissions line_count runtime_filename manifest_cdhash
  if [[ -L "${runtime_manifest_path}" || ! -f "${runtime_manifest_path}" || ! -O "${runtime_manifest_path}" ]]; then
    return 1
  fi
  manifest_owner="$(/usr/bin/stat -f '%u' "${runtime_manifest_path}" 2>/dev/null)" || return 1
  manifest_permissions="$(/usr/bin/stat -f '%Sp' "${runtime_manifest_path}" 2>/dev/null)" || return 1
  if [[ "${manifest_owner}" != "${UID}" || "${manifest_permissions[6]}" == "w" || "${manifest_permissions[9]}" == "w" ]]; then
    return 1
  fi
  line_count="$(/usr/bin/wc -l < "${runtime_manifest_path}" | /usr/bin/tr -d '[:space:]')" || return 1
  [[ "${line_count}" == "2" ]] || return 1
  runtime_filename="$(/usr/bin/sed -n '1p' "${runtime_manifest_path}")"
  manifest_cdhash="$(/usr/bin/sed -n '2p' "${runtime_manifest_path}")"
  /usr/bin/printf '%s\n' "${runtime_filename}" \
    | /usr/bin/grep --extended-regexp --quiet '^node-[[:xdigit:]]{40}$' || return 1
  /usr/bin/printf '%s\n' "${manifest_cdhash}" \
    | /usr/bin/grep --extended-regexp --quiet '^[[:xdigit:]]{40}$' || return 1
  [[ "${runtime_filename#node-}" == "${manifest_cdhash}" ]] || return 1
  node_path="${runtime_dir}/${runtime_filename}"
  expected_cdhash="${manifest_cdhash}"
}

runtime_is_trusted() {
  local candidate="$1" actual_cdhash
  /usr/bin/codesign --verify --strict "${candidate}" >/dev/null 2>&1 || return 1
  actual_cdhash="$(/usr/bin/codesign -dv --verbose=4 "${candidate}" 2>&1 \
    | /usr/bin/sed -n 's/^CDHash=//p')"
  [[ -n "${actual_cdhash}" && "${actual_cdhash:l}" == "${expected_cdhash:l}" ]] || return 1
  runtime_entitlements_are_minimal "${candidate}" || return 1
  dependencies_are_system_only "${candidate}"
}

prepare_private_paths() {
  ensure_private_directory "${state_dir}" || return 1
  ensure_private_directory "${runtime_dir}" || return 1
  ensure_private_directory "${log_dir}" || return 1
  if [[ -e "${log_path}" && (-L "${log_path}" || ! -f "${log_path}" || ! -O "${log_path}") ]]; then
    return 1
  fi
  if [[ -e "${log_path}" ]]; then
    /bin/chmod 600 "${log_path}" || return 1
  fi
  if [[ -e "${launcher_log_path}" && (-L "${launcher_log_path}" || ! -f "${launcher_log_path}" || ! -O "${launcher_log_path}") ]]; then
    return 1
  fi
  if [[ -e "${launcher_log_path}" ]]; then
    /bin/chmod 600 "${launcher_log_path}" || return 1
  fi
  if [[ -e "${launcher_lock_path}" && (-L "${launcher_lock_path}" || ! -f "${launcher_lock_path}" || ! -O "${launcher_lock_path}") ]]; then
    return 1
  fi
  if [[ -e "${access_token_path}" && (-L "${access_token_path}" || ! -f "${access_token_path}" || ! -O "${access_token_path}") ]]; then
    return 1
  fi
  if [[ -e "${access_link_path}" && (-L "${access_link_path}" || ! -f "${access_link_path}" || ! -O "${access_link_path}") ]]; then
    return 1
  fi
  private_paths_ready=1
}

managed_job_exists() {
  /bin/launchctl print "${job_target}" >/dev/null 2>&1
}

wait_until_ready() {
  local deadline=$(( $(/bin/date +%s) + 30 ))
  while (( $(/bin/date +%s) < deadline )); do
    site_is_ready && return 0
    /bin/sleep 0.25
  done
  return 1
}

start_server() {
  local node_owner node_permissions
  load_runtime_manifest || return 1
  if [[ -L "${node_path}" || ! -f "${node_path}" || ! -x "${node_path}" || ! -O "${node_path}" ]]; then
    return 1
  fi
  runtime_is_trusted "${node_path}" || return 1
  node_owner="$(/usr/bin/stat -f '%u' "${node_path}" 2>/dev/null)" || return 1
  node_permissions="$(/usr/bin/stat -f '%Sp' "${node_path}" 2>/dev/null)" || return 1
  if [[ "${node_owner}" != "${UID}" || "${node_permissions[6]}" == "w" || "${node_permissions[9]}" == "w" ]]; then
    return 1
  fi

  : >"${log_path}" || return 1
  /bin/chmod 600 "${log_path}" || return 1

  /bin/launchctl submit \
    -l "${job_label}" \
    -o "${log_path}" \
    -e "${log_path}" \
    -- /bin/zsh -c 'cd "$1" && exec "$2" "$3" dev' _ \
      "${service_dir}" "${node_path}" "${service_dir}/scripts/run-framework.mjs" || return 1
  submitted_job=1
}

if ! prepare_private_paths; then
  show_error "바로발행의 사용자 전용 로그 폴더를 준비하지 못했습니다."
  exit 1
fi

if [[ "${server_port}" != <-> ]] || (( server_port < 1024 || server_port > 65535 )); then
  show_error "바로발행 전용 포트 설정이 올바르지 않습니다."
  exit 1
fi

if (( lock_held == 0 )); then
  lock_args=(--with-launch-lock)
  if (( background_mode == 1 )); then
    lock_args+=(--background)
  fi
  /usr/bin/lockf -k -t 40 "${launcher_lock_path}" /bin/zsh "$0" "${lock_args[@]}"
  lock_status=$?
  if (( lock_status >= 64 && lock_status <= 78 )); then
    show_error "다른 바로발행 실행을 기다리는 동안 시간이 초과됐습니다."
  fi
  exit "${lock_status}"
fi

if [[ -L "${launcher_lock_path}" || ! -f "${launcher_lock_path}" || ! -O "${launcher_lock_path}" ]]; then
  show_error "바로발행의 실행 잠금 파일을 안전하게 준비하지 못했습니다."
  exit 1
fi
/bin/chmod 600 "${launcher_lock_path}" || exit 1

if ! prepare_access_token; then
  show_error "바로발행의 사용자 전용 DB 인증 정보를 준비하지 못했습니다."
  exit 1
fi

if site_is_ready; then
  write_launcher_log "기존 서버 재사용: ${service_url}"
  open_site
  exit 0
fi

if ! site_is_ready; then
  if managed_job_exists; then
    /bin/launchctl remove "${job_label}" >/dev/null 2>&1 || true
  fi

  if /usr/sbin/lsof -nP -iTCP:"${server_port}" -sTCP:LISTEN >/dev/null 2>&1; then
    show_error "바로발행 전용 포트 ${server_port}을 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료한 뒤 다시 실행해 주세요."
    exit 1
  fi

  if [[ ! -d "${service_dir}" ]] || ! start_server; then
    show_error "바로발행 개발 서버를 시작하지 못했습니다."
    exit 1
  fi

  if ! wait_until_ready; then
    if (( submitted_job == 1 )); then
      /bin/launchctl remove "${job_label}" >/dev/null 2>&1 || true
      submitted_job=0
    fi
    show_error "바로발행 서버가 30초 안에 준비되지 않아 중지했습니다."
    exit 1
  fi
fi

if site_is_ready; then
  prepare_access_token || {
    show_error "바로발행의 사용자 전용 DB 인증 정보를 갱신하지 못했습니다."
    exit 1
  }
  write_launcher_log "준비 완료: ${service_url}"
  open_site
else
  if (( submitted_job == 1 )); then
    /bin/launchctl remove "${job_label}" >/dev/null 2>&1 || true
    submitted_job=0
  fi
  show_error "바로발행 서버 상태를 확인하지 못했습니다."
  exit 1
fi
