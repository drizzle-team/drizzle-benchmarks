import { spawn } from "bun";

const cpus = navigator.hardwareConcurrency;
const buns = new Array(cpus);

const who = Bun.argv[2];
for (let i = 0; i < cpus; i++) {
    buns[i] = spawn({
        cmd: ["bun", `src/${who}-server-bun.ts`],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
    });
}

function kill() {
    for (const b of buns) {
        b.kill()
    }
}

process.on("SIGINT", kill);
process.on("exit", kill)