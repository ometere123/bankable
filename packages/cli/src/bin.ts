#!/usr/bin/env -S npx tsx
import { runCli } from "./run";
runCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), env: process.env }).then((c) => process.exit(c), (e) => { console.error(String(e?.message ?? e)); process.exit(70); });
