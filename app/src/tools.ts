import { LLMBase, ToolDefinition, Type, s } from "./llm/index.ts";
import { exec, ExecException } from 'child_process';
import fs from "fs/promises";
import path from "path";

class ExecError extends Error {
    name = "ExecError";
    exception;
    stdout;
    stderr;
    constructor(exception: ExecException, stdout: string, stderr: string) {
        super(exception.message);
        this.exception = exception;
        this.stdout = stdout;
        this.stderr = stderr;
    }
}

function execAsync(script: string): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    return new Promise((resolve, reject) => {
        exec(script, {
            shell: '/bin/bash',
        }, (error, stdout, stderr) => {
            const exitCode = error?.code || 0;
            if (error) {
                reject(new ExecError(error, stdout, stderr));
            } else {
                resolve({ stdout, stderr, exitCode });
            }
        });
    });
}

export function saveMessages<LLM extends LLMBase<LLM>>(llm: LLM) {
    const messages = llm.messages.map(message => {
        if ("native" in message) message.native = false;
        return message;
    });
    const messagesFile = path.join(process.cwd(), "messages.json");
    return fs.writeFile(messagesFile, JSON.stringify(messages, null, 2));
}

const runBashSchema = s.object({
    script: s.string(),
});
type RunBashSchema = Type<typeof runBashSchema>;

export const run_bash: ToolDefinition<RunBashSchema> = {
    description: "Run a bash command (single-line) or script (multi-line). If you need to run \
multiple independent commands, coalesce them into a single script. If you want to read a file, \
use the `select_lines` tool instead.",
    parameters: runBashSchema,
    async callback(args) {
        // console.log('Running bash:\n```\n' + args.script + '\n```');
        try {
            const output = await execAsync(args.script);
            return {
                exitCode: 0,
                stdout: output.stdout,
                stderr: output.stderr
            };
        } catch (error: any) {
            if (error instanceof ExecError) {
                const exception = error.exception;
                console.log("Bash failed:\n```\nstdout:\n" + error.stdout + "\nstderr:\n" + error.stderr + "\n```");
                return {
                    exitCode: exception.code || 1,
                    stdout: error.stdout?.toString() || '',
                    stderr: error.stderr?.toString() || exception.message
                };
            }
            throw error;
        }
    }
}

let selectedLines: {
    file: string;
    lines: string[];
    start: number;
    end: number;
} | null = null;
const selectLinesSchema = s.object({
    file: s.string(),
    start: s.number(),
    end: s.number(),
});
type SelectLinesSchema = Type<typeof selectLinesSchema>;

export const select_lines: ToolDefinition<SelectLinesSchema> = {
    description: "Select lines from a file to edit (1-indexed, inclusive to start and end). Set \
`end` to 0 to select to the end of the file. Try to use small selections to reduce token usage.",
    parameters: selectLinesSchema,
    async callback(args) {
        const file = await fs.readFile(args.file, "utf-8");
        const lines = file.split("\n");
        selectedLines = {
            file: args.file,
            start: args.start,
            end: args.end,
            lines,
        };
        return lines.slice(args.start - 1, args.end || undefined); //.join("\n");
    }
}

const replaceLinesSchema = s.object({
    content: s.union([s.string(), s.list(s.string())]),
})
type ReplaceLinesSchema = Type<typeof replaceLinesSchema>;

export const replace_lines: ToolDefinition<ReplaceLinesSchema> = {
    description: "Replace the selected lines with the given content.",
    parameters: replaceLinesSchema,
    async callback(args) {
        if (typeof args.content == "string") {
            args.content = args.content.split("\n");
        }
        selectedLines!.lines.splice(selectedLines!.start - 1, selectedLines!.end - selectedLines!.start + 1, ...args.content);
        await fs.writeFile(selectedLines!.file, selectedLines!.lines.join("\n"));
        return {
            exitCode: 0,
            stdout: "",
            stderr: ""
        };
    }
}

const emptySchema = s.object({});
type EmptySchema = Type<typeof emptySchema>;

export const restart: ToolDefinition<EmptySchema> = {
    description: "Restart the application, keeping all memory. This also creates a save point to revert to if new modifications fail.",
    parameters: emptySchema,
    async callback() {
        console.log("Restarting");
        await saveMessages(this);
        process.exit(0);
    }
}

export const revert: ToolDefinition<EmptySchema> = {
    description: "Revert to the previous save point created by `restart`.",
    parameters: emptySchema,
    async callback() {
        console.log("Reverting");
        await saveMessages(this);
        process.exit(0);
    }
}

export const get_prompt: ToolDefinition<EmptySchema> = {
    description: "Get the original system prompt.",
    parameters: emptySchema,
    async callback() {
        return (await fs.readFile("prompt.md", "utf-8")).replace(/\\\r?\n/g, "");
    }
}