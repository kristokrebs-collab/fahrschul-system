import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { DriveLockProvider } from "./state/DriveLockContext.js";
import { SessionProvider } from "./state/SessionContext.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <DriveLockProvider>
          <App />
        </DriveLockProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
