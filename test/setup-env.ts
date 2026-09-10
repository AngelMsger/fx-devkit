// Git fixtures must not inherit machine-specific line conversion, signing,
// hooks or credentials from the developer's global and system configuration.
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
