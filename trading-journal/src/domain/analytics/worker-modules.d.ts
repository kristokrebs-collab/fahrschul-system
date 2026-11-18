/** Vite inline workers (`import W from "./x.worker?worker&inline"`): a constructor of a classic worker from a blob. */
declare module "*?worker&inline" {
  const WorkerFactory: new (options?: { name?: string }) => Worker;
  export default WorkerFactory;
}
