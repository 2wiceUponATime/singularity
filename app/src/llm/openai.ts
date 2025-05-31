import { OpenAI } from "openai";
import { ResponseInputItem } from "openai/resources/responses/responses";
import { LLMBase, Message, Tool } from "./base.ts";
import { Builder } from "xml2js";

let client: OpenAI | null = null;

export class LLMOpenAI extends LLMBase<LLMOpenAI> {

    protected override async _getResponse(model: string, messages: Message[], tools: Tool[]): Promise<Message[]> {
        if (!client) {
            client = new OpenAI();
        }
        const input = messages.map((message): ResponseInputItem => {
            const builder = new Builder({
                renderOpts: {
                    pretty: false,
                    indent: '',
                    newline: ''
                },
                headless: true
            });
            switch (message.type) {
                case "text":
                    return {
                        role: message.role,
                        content: message.content,
                    }
                case "tool_call":
                    if (message.native) {
                        return {
                            type: "function_call",
                            call_id: message.call_id,
                            name: message.name,
                            arguments: JSON.stringify(message.arguments),
                        }
                    } else {
                        return {
                            role: "system",
                            content: "Assistant tool call:\n" + builder.buildObject({
                                tool: {
                                    $: {
                                        name: message.name,
                                        id: message.call_id
                                    },
                                    _: JSON.stringify(message.arguments)
                                }
                            })
                        }
                    }
                case "tool":
                    if (message.native) {
                        return {
                            type: "function_call_output",
                            call_id: message.call_id,
                            output: JSON.stringify(message.result),
                        }
                    } else {
                        return {
                            role: "system",
                            content: builder.buildObject({
                                toolResult: {
                                    $: {
                                        name: message.name,
                                        id: message.call_id
                                    },
                                    _: JSON.stringify(message.result)
                                }
                            })
                        }
                    }
            }
        });
        const openaiTools: OpenAI.Responses.Tool[] = tools.map(tool => ({
            ...tool,
            type: "function",
            strict: false,
            parameters: tool.parameters as Record<string, unknown>,
        }));
        const response = await client.responses.create({
            model,
            input,
            tools: openaiTools
        });
        const result: Message[] = [];
        for (const output of response.output) {
            switch (output.type) {
                case "function_call":
                    result.push({
                        type: "tool_call",
                        native: true,
                        call_id: output.call_id,
                        name: output.name,
                        arguments: JSON.parse(output.arguments)
                    });
                    break;
                case "message":
                    for (const content of output.content) {
                        if (content.type == "refusal") {
                            throw new Error(`Refusal: ${content.refusal}`);
                        }
                        result.push({
                            type: "text",
                            role: output.role,
                            content: content.text
                        });
                    }
                    break;
                default:
                    throw new Error(`Unknown output type: ${output.type}`);
            }
        }
        return result;
    }
}