// The slice of a file system the use cases need: text and binary files,
// directory copies and existence. An absent file reads as undefined rather than throwing, so
// "optional document" is a plain branch, not an exception.

export interface FileReader {
  readBytes(path: string): Promise<Uint8Array | undefined>;
  readText(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
  // An absent directory has no direct children.
  readDir(path: string): Promise<string[]>;
  isDirectory(path: string): Promise<boolean>;
  // Undefined means the path is not a symbolic link.
  readLink(path: string): Promise<string | undefined>;
  realpath(path: string): Promise<string>;
}

export interface FileSystem extends FileReader {
  ensureDir(path: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array, executable?: boolean): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  link(target: string, at: string): Promise<void>;
  copyDir(from: string, to: string): Promise<void>;
  // Atomically move an approved path to an unused sibling, preserving the object itself.
  moveToBackup(path: string): Promise<string>;
  replaceDir(from: string, to: string): Promise<void>;
  // Removes only files, links or directories fx created.
  remove(path: string): Promise<void>;
}
