import { Message } from "./llm/index.ts";
import { LLMOllama } from "./llm/ollama.ts";
import { run_bash, restart, revert, select_lines, replace_lines, get_prompt } from "./tools.ts";
import { readFile } from "fs/promises";

let messages: Message[];
try {
    messages = JSON.parse(await readFile("messages.json", "utf-8"));
} catch (error) {
    messages = [{
        type: "text",
        role: "system",
        content: (await readFile("prompt.md", "utf-8")).replace(/\\\r?\n/g, "")
    }];
}

export const llm = new LLMOllama({
    model: process.env.OLLAMA_MODEL!,
    temperature: 0.3,
    tools: {
        run_bash,
        restart,
        revert,
        select_lines,
        replace_lines,
        get_prompt,
    },
    messages,
});