// 상위 LocalCrab(OpenCrab)을 pin.json의 고정 commit으로 받는다. 다른 PC에서 왕복 시험 전에 한 번 실행한다.
// 사용: node factory/localcrab/fetch-upstream.mjs  (기본 위치 var/upstream/OpenCrab, git 필요)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(readFileSync(path.join(here, "pin.json"), "utf8"));
const target = process.env.OPENCRAB_PATH ?? path.join(here, "..", "..", "var", "upstream", "OpenCrab");
const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
if (!existsSync(target)) {
  mkdirSync(path.dirname(target), { recursive: true });
  git("clone", "--quiet", pin.repository, target);
}
git("-C", target, "fetch", "--quiet", "origin");
git("-C", target, "checkout", "--quiet", "--detach", pin.commit);
const head = git("-C", target, "rev-parse", "HEAD");
if (head !== pin.commit) throw new Error("고정 commit으로 맞추지 못했습니다: " + head);
console.log("OpenCrab " + head + " → " + target);
