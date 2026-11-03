can_prompt() {
	[[ -r /dev/tty && -w /dev/tty ]]
}

read_tty() {
	local var="$1"
	local hidden="${2:-}"
	local value=""
	if [[ -n "$hidden" ]]; then
		read -r -s value </dev/tty || true
		printf '\n' >/dev/tty
	else
		read -r value </dev/tty || true
	fi
	printf -v "$var" '%s' "$value"
}

# Returns 0 for yes. Default is n unless the second argument is y.
prompt_yn() {
	local question="$1"
	local default="${2:-n}"
	local reply=""
	if ! can_prompt; then
		return 1
	fi
	local hint="y/N"
	if [[ "$default" == "y" ]]; then
		hint="Y/n"
	fi
	printf '%s [%s] ' "$question" "$hint" >/dev/tty
	read_tty reply
	reply="$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
	if [[ -z "$reply" ]]; then
		[[ "$default" == "y" ]]
		return
	fi
	[[ "$reply" == "y" || "$reply" == "yes" ]]
}
