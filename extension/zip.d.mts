/** Packs a folder into a zip (see zip.mjs). */
export function zipDirectory(folder: string, outFile: string): { entries: number; bytes: number };
/** Reads the entries of a zip written by zipDirectory; checks every CRC. */
export function listZip(archive: Buffer): Array<{ name: string; data: Buffer }>;
