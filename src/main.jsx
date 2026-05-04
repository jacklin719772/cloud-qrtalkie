import React from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { initPrototype } from "../app.js";

function StaticPrototype() {
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: document.querySelector("#static-prototype").innerHTML,
      }}
    />
  );
}

createRoot(document.querySelector("#root")).render(<StaticPrototype />);
queueMicrotask(initPrototype);
