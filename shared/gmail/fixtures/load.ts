/// <reference types="vite/client" />
/**
 * The sample mails next to this file, for tests. Each `name.txt` is a mail (From, Subject and
 * Received headers, a blank line, the body) and `name.json` what triage and the rules should
 * make of it. The bodies are written from real mails with names, numbers and ids changed.
 */
import type { Mail } from "../mail";
import type { DropReason } from "../triage";

export type Expected = { triage: "keep"; parsed: Record<string, unknown> } | { triage: DropReason };
export type Fixture = { name: string; mail: Mail; expected: Expected };

const texts = import.meta.glob("./*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const expectations = import.meta.glob("./*.json", { import: "default", eager: true }) as Record<string, Expected>;

export function fixtures(): Fixture[] {
  return Object.entries(texts).map(([path, text], i) => {
    const name = path.replace(/^.*\//, "").replace(/\.txt$/, "");
    const [head, ...rest] = text.split(/\r?\n\r?\n/);
    const header = (k: string) => head.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1] ?? "";
    const mail: Mail = { id: `m${i}`, threadId: `t${i}`, from: header("From"), subject: header("Subject"), receivedAt: Date.parse(header("Received")), text: rest.join("\n\n") };
    const expected = expectations[path.replace(/\.txt$/, ".json")];
    if (!expected) throw new Error(`No ${name}.json beside ${name}.txt`);
    return { name, mail, expected };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
