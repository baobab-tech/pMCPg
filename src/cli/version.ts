// Version comes from package.json, bundled into the binary. The release workflow sets it from the tag.
import pkg from "../../package.json";

export const VERSION: string = pkg.version;
