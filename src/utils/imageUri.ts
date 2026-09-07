/**
 * Normalizes a local filesystem path into a URI React Native's <Image>
 * component can load on Android. Android's image loader requires a scheme
 * (`file://`, `content://`, `http(s)://`) -- a bare absolute path (what
 * RNFS.DocumentDirectoryPath-based paths are, e.g.
 * `/data/user/0/.../observations/<id>/original.jpg`) silently fails to
 * render there, though iOS is lenient about it. Every persisted photo/crop
 * path in this app (observationStorage, packManager reference photos) is a
 * bare path for historical reasons, so callers normalize at render time
 * rather than migrating every persisted path.
 */
export function toDisplayUri(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    // Already has a scheme (file://, content://, http(s)://, ...).
    return path;
  }
  return `file://${path}`;
}
