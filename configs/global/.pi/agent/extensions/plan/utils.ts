/**
 * Pure utility functions for plan mode.
 * Plan mode blocks commands with write/destructive side effects, while allowing
 * non-mutating analysis commands that are not explicitly deny-listed.
 */

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bsed\b[^\n;|&]*\s-i\b/i,
	/\bperl\b[^\n;|&]*\s-i\b/i,
	/\b(prettier|eslint|stylelint)\b[^\n;|&]*(--write|--fix)\b/i,
	/\b(npm|yarn|pnpm)\s+(install|uninstall|update|ci|link|publish|add|remove|upgrade)\b/i,
	/\b(pip|pip3|uv)\s+(install|uninstall|sync|add|remove)\b/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|clean)\b/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
	/\bservice\s+\S+\s+(start|stop|restart)\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

export function isSafeCommand(command: string): boolean {
	return !DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
}
