import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BenchmarkProvider, useBenchmarkContext } from "./benchmark/context/useBenchmarkContext";
import ControlPanel from "./benchmark/components/ControlPanel/ControlPanel";
import type { IRuns } from "./benchmark/types";

function Viewer() {
  const [runs, setRuns] = useState<IRuns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selectedItems, setSelectedItems } = useBenchmarkContext();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as IRuns;
      setRuns(data);
      setError(null);
      const names = Object.keys(data);
      // keep the current pair if still present; otherwise default to drizzle-ish run on the left
      setSelectedItems((prev) => {
        if (names.includes(prev.left) && names.includes(prev.right)) return prev;
        const left = names.find((n) => n.toLowerCase().includes("drizzle")) ?? names[0] ?? "";
        const right = names.find((n) => n !== left) ?? left;
        return { left, right };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setSelectedItems]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = !root.classList.contains("dark");
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  };

  const names = runs ? Object.keys(runs) : [];

  return (
    <div className="page">
      <div className="page__inner">
      <header className="page__header">
        <h1 className="page__title">Benchmarks</h1>
        <div className="page__meta">
          <span>{runs ? `${names.length} run${names.length === 1 ? "" : "s"}` : "loading…"}</span>
          <button type="button" onClick={load}>
            Reload
          </button>
          <button type="button" onClick={toggleTheme}>
            Theme
          </button>
        </div>
      </header>
      {error && <p className="page__empty">Failed to load runs: {error}</p>}
      {runs && names.length === 0 && (
        <p className="page__empty">
          No runs found. Run a benchmark first, e.g. <code>bun bench/index.ts http://host:3000 drizzle</code>, then
          press Reload.
        </p>
      )}
      {runs && names.length > 0 && selectedItems.left && <ControlPanel runs={runs} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <BenchmarkProvider>
    <Viewer />
  </BenchmarkProvider>,
);
