import { LLMBase, Message, Tool, LLMConfig } from "./base.ts";
import { Ollama, Message as OllamaMessage, Tool as OllamaTool } from "ollama";

let ollama: Ollama | null = null;

export class LLMOllama extends LLMBase<LLMOllama> {
    private pullPromise: Promise<void> | null = null;
    private temperature: number = 0.5;
    private get ollama() {
        if (!ollama) {
            ollama = new Ollama({
                host: process.env.OLLAMA_HOST,
            });
        }
        return ollama;
    }

    constructor(options: LLMConfig<LLMOllama> & { temperature?: number }) {
        super(options);
        if (options.temperature) {
            this.temperature = options.temperature;
        }
    }

    async pull(model: string) {
        function log(newText: string) {
            if (text !== newText) {
                console.log(newText);
                text = newText;
            }
        }
        let text: string | null = null;
        console.log(`Pulling ${model}`);
        const stream = await this.ollama.pull({
            model,
            stream: true,
        });
        for await (const chunk of stream) {
            const progress = chunk.completed / chunk.total;
            if (isNaN(progress)) {
                log(chunk.status);
                continue;
            }
            const start = `${chunk.status}: [`;
            const end = `] ${Math.round(progress * 100)}%`;
            const barLength = 80 - start.length - end.length;
            const filledLength = Math.floor(barLength * progress);
            const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
            log(`${start}${bar}${end}`);
        }
        console.log(`Pulled ${model}`);
    }

    protected override async _getResponse(model: string, messages: Message[], tools: Tool[]): Promise<Message[]> {
        if (!this.pullPromise) {
            this.pullPromise = this.pull(model);
        }
        await this.pullPromise;
        const response = await this.ollama.chat({
            model,
            options: {
                temperature: this.temperature,
            },
            messages: messages.map((message): OllamaMessage => {
                switch (message.type) {
                    case "text":
                        return {
                            role: message.role,
                            content: message.content,
                        };
                    case "tool_call":
                        if (!(message.arguments instanceof Object)) {
                            throw new Error("Tool call arguments must be an object");
                        }
                        return {
                            role: "assistant",
                            content: "",
                            tool_calls: [{
                                function: {
                                    name: message.name,
                                    arguments: message.arguments,
                                },
                            }],
                        }
                    case "tool":
                        return {
                            role: "tool",
                            content: JSON.stringify(message.result),
                        }
                }
            }),
            tools: tools.map((tool): OllamaTool => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters as unknown as { type?: string; properties?: Record<string, any> },
                },
            })),
        });
        const result: Message[] = [{
            type: "text",
            role: "assistant",
            content: response.message.content,
        }];

        for (const toolCall of response.message.tool_calls ?? []) {
            result.push({
                type: "tool",
                name: toolCall.function.name,
                result: toolCall.function.arguments,
                native: true,
                call_id: crypto.randomUUID(),
            })
        }
        return result;
    }
}