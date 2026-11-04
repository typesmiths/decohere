import module from "node:module";

// Imported first by the bins: Node keeps the compiled code of every module it loads after
// this, so the next start skips compiling them again.
module.enableCompileCache();
