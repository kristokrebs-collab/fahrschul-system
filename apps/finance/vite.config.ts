import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // 5176 statt 5175: 5175 gehört apps/instructor, sonst starten die beiden
  // nicht gleichzeitig. Siehe apps/student/vite.config.ts.
  server: { port: 5176, strictPort: true },
});
