import { useEffect, useMemo } from "react";
import { initPrototype } from "../../app.js";

export function StaticPrototype() {
  const prototypeHtml = useMemo(() => document.querySelector("#static-prototype")?.innerHTML || "", []);

  useEffect(() => {
    initPrototype();
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{
        __html: prototypeHtml,
      }}
    />
  );
}
