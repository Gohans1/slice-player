import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { newestChange, RUST_SERVER, serverPlan } from "./refresh";

it("dates code by its newest source file, however deep, but not by its tests", () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-"));
  const file = (path: string, seconds: number) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "");
    utimesSync(join(root, path), seconds, seconds);
  };
  try {
    file("src/server/index.ts", 1000);
    file("src/server/lib/plays.ts", 3000);
    file("src/server/plays.test.ts", 4000);
    file("package.json", 2000);

    expect(newestChange(root, ["src/server", "package.json", "bunfig.toml"])).toBe(3_000_000);

    file("Cargo.toml", 2500);
    file("Cargo.lock", 3100);
    file("crates/engine/Cargo.toml", 3200);
    file("crates/engine/src/server.rs", 3500);
    file("crates/engine/src/db_test.rs", 5000);
    file("crates/engine/tests/http_and_crud_test.rs", 6000);

    expect(newestChange(root, RUST_SERVER)).toBe(3_500_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("restarts a server started before its code changed, unless it is downloading", () => {
  expect(serverPlan({ startedAt: 2000, downloading: 0 }, 1000)).toBe("current");
  expect(serverPlan({ startedAt: 1000, downloading: 0 }, 2000)).toBe("restart");
  // Restarting marks the songs it was downloading as failed
  expect(serverPlan({ startedAt: 1000, downloading: 2 }, 2000)).toBe("busy");
  expect(serverPlan({ startedAt: 1000, downloading: null }, 2000)).toBe("busy");
});
