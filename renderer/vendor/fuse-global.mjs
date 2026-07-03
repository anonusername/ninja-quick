// fuse.js v7+ dropped its classic UMD/global browser build (only ships ESM .mjs / CJS .cjs now).
// renderer.js loads as a plain classic <script> (no bundler, no type="module"), so this tiny
// module shim imports the vendored ESM build and republishes it as window.Fuse. Module scripts
// are deferred until after document parsing, but renderer.js only touches window.Fuse from
// inside async/event-driven code paths (never at classic-script top-level), so there's no
// ordering race in practice.
import Fuse from './fuse.min.mjs';
window.Fuse = Fuse;
