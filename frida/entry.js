// Bundles carplay-trace.js with frida-java-bridge for frida-inject.
// Since Frida 17 the Java bridge is no longer preloaded in a plain
// script runtime (frida-inject), so it must be bundled explicitly.
//
// Build:  npx frida-compile entry.js -o carplay-trace-compiled.js
// The compiled bundle contains a "✄"-separated source map at the end;
// strip everything from the "✄" line onward before pushing to the device.
import Java from 'frida-java-bridge';

globalThis.Java = Java;

require('./trace-body.js');
