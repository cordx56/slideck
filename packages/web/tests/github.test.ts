import { describe, it, expect } from "vitest";
import { gitBlobSha } from "../src/github/blob-sha";
import { classify, isConflict, type Baseline } from "../src/github/sync";
import { parseRepoPath } from "../src/github/client";

describe("gitBlobSha", () => {
  it("matches git hash-object", async () => {
    const enc = new TextEncoder();
    // git hash-object of empty / "a"
    expect(await gitBlobSha(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(await gitBlobSha(enc.encode("a"))).toBe("2e65efe2a145dda7ee51d1741299f848e5bf752e");
  });
});

describe("classify (three-way diff)", () => {
  const run = (l: [string, string][], r: [string, string][], b: Baseline) =>
    classify(new Map(l), new Map(r), b);

  it("same / remote & local new", () => {
    const s = run([["/a", "x"], ["/c", "n"]], [["/a", "x"], ["/d", "m"]], { "/a": "x" });
    expect(s.get("/a")).toBe("same");
    expect(s.get("/c")).toBe("localNew");
    expect(s.get("/d")).toBe("remoteNew");
  });

  it("remote vs local modification", () => {
    const s = run([["/a", "B"], ["/b", "L"]], [["/a", "R"], ["/b", "B"]], { "/a": "B", "/b": "B" });
    expect(s.get("/a")).toBe("remoteModified"); // local unchanged (==base), remote changed
    expect(s.get("/b")).toBe("localModified"); // remote unchanged (==base), local changed
  });

  it("conflicts: both modified / delete vs modify", () => {
    const s = run([["/a", "L"], ["/c", "L"]], [["/a", "R"], ["/d", "R"]], {
      "/a": "B",
      "/c": "B",
      "/d": "B",
    });
    expect(s.get("/a")).toBe("bothModified");
    expect(s.get("/c")).toBe("remoteDeletedLocalModified"); // local changed, remote removed
    expect(s.get("/d")).toBe("localDeletedRemoteModified"); // local removed, remote changed
    expect([...s.values()].filter(isConflict)).toHaveLength(3);
  });

  it("clean deletions", () => {
    const s = run([["/a", "B"]], [["/b", "B"]], { "/a": "B", "/b": "B", "/c": "B" });
    expect(s.get("/a")).toBe("remoteDeleted"); // local has it (==base), remote removed
    expect(s.get("/b")).toBe("localDeleted"); // remote has it (==base), local removed
    expect(s.get("/c")).toBe("bothDeleted"); // gone from both
  });
});

describe("parseRepoPath", () => {
  it("accepts valid owner/repo and trims", () => {
    expect(parseRepoPath("  octocat/Hello-World.js  ")).toEqual({
      owner: "octocat",
      repo: "Hello-World.js",
    });
  });

  it("rejects malformed or injection-prone input", () => {
    for (const bad of [
      "octocat", // no slash
      "octocat/repo/extra", // too many segments
      "octocat/re po", // space in repo
      "-octocat/repo", // owner starts with hyphen
      "oct--ocat/repo", // consecutive hyphens in owner
      "owner/re$po", // illegal repo char
      "../repo", // path traversal attempt
    ]) {
      expect(parseRepoPath(bad)).toBeNull();
    }
  });
});
