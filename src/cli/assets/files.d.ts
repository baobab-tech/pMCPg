// `with { type: "file" }` imports resolve to an embedded file path.
declare module "*.icns" {
  const path: string;
  export default path;
}
declare module "*.ico" {
  const path: string;
  export default path;
}
declare module "*.png" {
  const path: string;
  export default path;
}
