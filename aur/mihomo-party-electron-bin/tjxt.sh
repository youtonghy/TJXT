#!/usr/bin/bash

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-~/.config}

# Allow users to override command-line options
if [[ -f "${XDG_CONFIG_HOME}/tjxt-flags.conf" ]]; then
	mapfile -t TJXT_USER_FLAGS <<<"$(grep -v '^#' "${XDG_CONFIG_HOME}/tjxt-flags.conf")"
	echo "User flags:" ${TJXT_USER_FLAGS[@]}
fi

# Launch
exec electron /opt/tjxt ${TJXT_USER_FLAGS[@]} "$@"
