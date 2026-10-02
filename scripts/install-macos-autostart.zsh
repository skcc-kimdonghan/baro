#!/bin/zsh

set -eu

readonly service_dir="/Users/dhkim/Source/AI Talent/AInsight/business-app-project/services/naver-blog-finalizer"
readonly state_dir="/Users/dhkim/Library/Application Support/바로발행"
readonly runtime_dir="${state_dir}/runtime"
readonly runtime_manifest_path="${runtime_dir}/runtime-manifest"
readonly runtime_entitlements="${service_dir}/scripts/node-runtime-entitlements.plist"
readonly source_node="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
readonly source_requirement='=identifier "node" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "2DC432GLL2"'
readonly expected_team_identifier="TeamIdentifier=2DC432GLL2"
readonly log_dir="/Users/dhkim/Library/Logs/바로발행"
readonly launcher_lock_path="${state_dir}/launcher.lockf"
readonly desktop_launcher="/Users/dhkim/Desktop/바로발행.app/Contents/MacOS/launch"
readonly agent_source="${service_dir}/scripts/com.local.naver-blog-finalizer.autostart.plist"
readonly agent_target="/Users/dhkim/Library/LaunchAgents/com.local.naver-blog-finalizer.autostart.plist"
readonly agent_label="com.local.naver-blog-finalizer.autostart"
readonly server_label="com.local.naver-blog-finalizer.server"

install_lock_held=0
runtime_temp=""
manifest_temp=""

for installer_arg in "$@"; do
  case "${installer_arg}" in
    --with-install-lock) install_lock_held=1 ;;
    *) exit 64 ;;
  esac
done

cleanup_install_files() {
  [[ -z "${runtime_temp}" || ! -e "${runtime_temp}" ]] || /bin/rm -f "${runtime_temp}"
  [[ -z "${manifest_temp}" || ! -e "${manifest_temp}" ]] || /bin/rm -f "${manifest_temp}"
}
trap cleanup_install_files EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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

source_runtime_is_trusted() {
  local candidate="$1" team_identifier
  /usr/bin/codesign --verify --strict --test-requirement "${source_requirement}" \
    "${candidate}" >/dev/null 2>&1 || return 1
  team_identifier="$(/usr/bin/codesign -dv --verbose=2 "${candidate}" 2>&1 \
    | /usr/bin/sed -n '/^TeamIdentifier=/p')"
  [[ "${team_identifier}" == "${expected_team_identifier}" ]] || return 1
  dependencies_are_system_only "${candidate}"
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

installed_runtime_is_trusted() {
  local candidate="$1"
  /usr/bin/codesign --verify --strict "${candidate}" >/dev/null 2>&1 || return 1
  runtime_entitlements_are_minimal "${candidate}" || return 1
  dependencies_are_system_only "${candidate}"
}

for private_dir in "${state_dir}" "${runtime_dir}" "${log_dir}" "/Users/dhkim/Library/LaunchAgents"; do
  if ! ensure_private_directory "${private_dir}"; then
    /usr/bin/printf '안전하지 않은 경로입니다: %s\n' "${private_dir}" >&2
    exit 1
  fi
done

if [[ -L "${launcher_lock_path}" || (-e "${launcher_lock_path}" && (! -f "${launcher_lock_path}" || ! -O "${launcher_lock_path}")) ]]; then
  /usr/bin/printf '%s\n' "바로발행 실행 잠금 파일이 안전하지 않습니다." >&2
  exit 1
fi

if (( install_lock_held == 0 )); then
  /usr/bin/lockf -k -t 60 "${launcher_lock_path}" /bin/zsh "$0" --with-install-lock
  exit $?
fi

if [[ ! -f "${launcher_lock_path}" || -L "${launcher_lock_path}" || ! -O "${launcher_lock_path}" ]]; then
  /usr/bin/printf '%s\n' "바로발행 설치 잠금을 확인하지 못했습니다." >&2
  exit 1
fi
/bin/chmod 600 "${launcher_lock_path}"

if [[ ! -f "${source_node}" || ! -x "${source_node}" ]]; then
  /usr/bin/printf '%s\n' "ChatGPT의 서명된 Node.js 런타임을 찾지 못했습니다." >&2
  exit 1
fi
if [[ ! -f "${runtime_entitlements}" || -L "${runtime_entitlements}" ]]; then
  /usr/bin/printf '%s\n' "Node.js 런타임 권한 설정을 찾지 못했습니다." >&2
  exit 1
fi
if [[ ! -f "${desktop_launcher:h:h}/Info.plist" ]]; then
  /usr/bin/printf '%s\n' "바탕화면의 바로발행.app을 찾지 못했습니다." >&2
  exit 1
fi

runtime_temp="$(/usr/bin/mktemp "${runtime_dir}/node.install.XXXXXX")"
/usr/bin/install -m 500 "${source_node}" "${runtime_temp}"

if ! source_runtime_is_trusted "${runtime_temp}"; then
  /usr/bin/printf '%s\n' "복사한 Node.js의 OpenAI 서명 또는 동적 라이브러리 검증에 실패했습니다." >&2
  exit 1
fi

version_ok="$("${runtime_temp}" -p 'const [major, minor] = process.versions.node.split(".").map(Number); major > 22 || (major === 22 && minor >= 13) ? "yes" : "no"')"
if [[ "${version_ok}" != "yes" ]]; then
  /usr/bin/printf '%s\n' "Node.js 22.13.0 이상이 필요합니다." >&2
  exit 1
fi

/usr/bin/codesign --force --sign - --options runtime \
  --entitlements "${runtime_entitlements}" "${runtime_temp}" >/dev/null
if ! installed_runtime_is_trusted "${runtime_temp}"; then
  /usr/bin/printf '%s\n' "설치용 Node.js의 최종 서명·권한 검증에 실패했습니다." >&2
  exit 1
fi

runtime_cdhash="$(/usr/bin/codesign -dv --verbose=4 "${runtime_temp}" 2>&1 \
  | /usr/bin/sed -n 's/^CDHash=//p')"
if ! /usr/bin/printf '%s\n' "${runtime_cdhash}" \
  | /usr/bin/grep --extended-regexp --quiet '^[[:xdigit:]]{40}$'; then
  /usr/bin/printf '%s\n' "복사한 런타임 식별값을 확인하지 못했습니다." >&2
  exit 1
fi

runtime_filename="node-${runtime_cdhash:l}"
runtime_target="${runtime_dir}/${runtime_filename}"
/bin/chmod 500 "${runtime_temp}"
/bin/mv -f "${runtime_temp}" "${runtime_target}"
runtime_temp=""

manifest_temp="$(/usr/bin/mktemp "${runtime_dir}/manifest.install.XXXXXX")"
/usr/bin/printf '%s\n%s\n' "${runtime_filename}" "${runtime_cdhash:l}" >"${manifest_temp}"
/bin/chmod 400 "${manifest_temp}"
/bin/mv -f "${manifest_temp}" "${runtime_manifest_path}"
manifest_temp=""

/usr/bin/install -m 755 "${service_dir}/scripts/desktop-launcher.zsh" "${desktop_launcher}"
/usr/bin/install -m 600 "${agent_source}" "${agent_target}"
/usr/bin/touch "${log_dir}/launcher.log" "${log_dir}/server.log"
/bin/chmod 600 "${log_dir}/launcher.log" "${log_dir}/server.log"

if /bin/launchctl print "gui/${UID}/${agent_label}" >/dev/null 2>&1; then
  /bin/launchctl bootout "gui/${UID}/${agent_label}"
fi
if /bin/launchctl print "gui/${UID}/${server_label}" >/dev/null 2>&1; then
  /bin/launchctl remove "${server_label}"
fi
/bin/launchctl bootstrap "gui/${UID}" "${agent_target}"

/usr/bin/printf '%s\n' "바로발행 바로가기와 로그인 자동 실행 설치가 완료됐습니다."
