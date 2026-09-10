// Prepares occupied destinations for replacement after the user approves.
// A false result leaves all paths untouched.
export type ReplaceFiles = (paths: readonly string[]) => Promise<boolean>;
