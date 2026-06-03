"use client";

import { useEffect, useState } from "react";

// Day/night toggle. Flips the `dark`/`light` class on <html> and persists the
// choice; the no-flash script in the root layout applies it on load.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    const el = document.documentElement;
    el.classList.remove("dark", "light");
    el.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  }

  return (
    <button
      onClick={toggle}
      className="rounded-md border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:text-ink"
      title={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
      aria-label="Toggle day/night theme"
    >
      {theme === "dark" ? "☀ Day" : "☾ Night"}
    </button>
  );
}
