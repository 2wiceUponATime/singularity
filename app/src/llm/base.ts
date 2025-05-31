import { Schema } from "./schema.ts";
import { parseStringPromise, Builder } from "xml2js";
import { s } from "./schema.ts";

function final<
  This,
  Args extends any[],
  Return
>(
  originalMethod: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
): typeof originalMethod {
  const methodName = String(context.name);

  context.addInitializer(function () {
    const subclassPrototype = Object.getPrototypeOf(this);
    const methodInSubclass = Object.getOwnPropertyDescriptor(subclassPrototype, methodName);

    if (methodInSubclass && methodInSubclass.value !== originalMethod) {
      throw new Error(`Cannot override final method '${methodName}'`);
    }
  });

  return originalMethod;
}

export type Tools<Self extends LLMBase<Self>> = Record<string, ToolDefinition<any, Self>>;

export interface LLMConfig<Self extends LLMBase<Self>> {
    model: string;
    tools?: Tools<Self>;
    messages?: Message[];
    [key: string]: unknown;
}

export type JSON = string | number | boolean | null | JSON[] | { [key: string]: JSON };

export type Message = {
    type: "text";
    role: "user" | "assistant" | "system";
    content: string;
} | ToolCall | ToolResult;

export type ToolCall = {
    type: "tool_call";
    native: boolean;
    call_id: string;
    name: string;
    arguments: JSON;
}

export type ToolResult = {
    type: "tool";
    native: boolean;
    call_id: string;
    name: string;
    result: JSON;
}

export type Tool<T extends object = any> = {
    name: string;
    description: string;
    parameters: Schema<T>;
}

export type ToolDefinition<T extends object, Self extends LLMBase<Self> = LLMBase<any>> = Omit<Tool<T>, "name"> & {callback: (this: Self, args: T) => JSON | Promise<JSON>}

export abstract class LLMBase<Self extends LLMBase<Self> = LLMBase<any>> {
    private model;
    private turnTools: Tools<Self> = {};
    protected ready: Promise<unknown>;
    protected useNativeTools = false;
    messages;
    tools: Tools<Self>;

    constructor(config: LLMConfig<Self>) {
        this.model = config.model;
        this.tools = config.tools ?? {};
        this.messages = config.messages ?? [];
        this.ready = this._getResponse(this.model, [
            {
                type: "text",
                role: "system",
                content: "Call the `use_native_tools` tool if you can access it."
            }
        ], [{
            name: "use_native_tools",
            description: "Use the built-in tools instead of XML",
            parameters: s.object({}),
        }]).then(messages => {
            this.useNativeTools = messages.some(message => message.type == "tool_call" && message.name == "use_native_tools");
            if (!this.useNativeTools) {
                console.log("Using XML tools");
            }
        });
    }

    protected _getResponse(_model: string, _messages: Message[], _tools: Tool[]): Promise<Message[]> {
        throw new Error("Not implemented");
    }

    addTurnTool<T extends object>(name: string, tool: ToolDefinition<T, Self>) {
        this.turnTools[name] = tool;
    }

    @final
    async getResponse() {
        await this.ready;
        let hasToolResults = true;
        const result: Message[] = [];
        const systemMessages: Message[] = [];
        let toolsMessage: Message | null = null;
        const getToolResult = async (call: ToolCall): Promise<ToolResult>  => {
            try {
                const tool = this.tools[call.name];
                if (!tool) {
                    throw new Error(`Tool ${call.name} not found`);
                }
                const result = await tool.callback.call(this as unknown as Self, call.arguments);
                return {
                    type: "tool",
                    native: call.native,
                    call_id: call.call_id,
                    name: call.name,
                    result
                }
            } catch (error) {
                return {
                    type: "tool",
                    native: call.native,
                    call_id: call.call_id,
                    name: call.name,
                    result: `Error: ${error}`
                }
            }
        }
        const getXmlTools = () => {
            const builder = new Builder({
                renderOpts: {
                    pretty: false,
                    indent: '',
                    newline: ''
                },
                headless: true
            });
            return builder.buildObject({
                tools: {
                    toolInfo: Object.entries(this.tools).map(([name, tool]) => ({
                        $: { name },
                        description: tool.description,
                        input: JSON.stringify(tool.parameters)
                    }))
                }
            }).replace(/^<tools>|<\/tools>$/g, "");
        }
        if (!this.useNativeTools) {
            toolsMessage = {
                type: "text",
                role: "system",
                content: "",
            };
            systemMessages.push(toolsMessage);
        }
        const tools = this.useNativeTools ? Object.entries(Object.assign(this.tools, this.turnTools)).map(([name, tool]) => ({
            name,
            ...tool
        })) : [];
        this.turnTools = {};
        while (hasToolResults) {
            if (toolsMessage) {
                toolsMessage.content = 'Call tools with <tool name="tool_name">{/* JSON input */}\
</tool>. A response can contain text, one or more tool calls, or both. Use the `id` attribute to \
organize multiple tool calls. Make sure to place the tool call in a <tool> tag with valid JSON \
directly inside (not in an <input> tag). The system will respond with a <toolResult> tag \
containing the tool\'s output, not ending the assistant\'s turn. If one tool call is dependent on \
the result of another, put them in separate messages. Available tools:\n' + getXmlTools();
            }
            hasToolResults = false;
            let response = await this._getResponse(this.model, this.messages.concat(systemMessages), tools);
            if (toolsMessage) {
                const newResponse: Message[] = [];
                for (const message of response) {
                    if (message.type != "text") {
                        newResponse.push(message);
                        continue;
                    }
                    const matches = message.content.match(/<tool\s([^>]|\[\s\S])*>[\s\S]*?<\/tool>/g);
                    if (!matches) {
                        newResponse.push(message);
                        continue;
                    }
                    if (message.content.trim()) newResponse.push(message);
                    for (const match of matches) {
                        console.log("Tool call:", match);
                        const getTool = async (xmlString: string): Promise<Message> => {
                            const xml = await parseStringPromise(xmlString);
                            const tool = xml.tool;
                            const name = tool.$.name;
                            if (!name) {
                                throw new Error("No tool name provided in 'name' attribute.");
                            }
                            return {
                                type: "tool_call",
                                native: this.useNativeTools,
                                call_id: tool.$.id ?? crypto.randomUUID(),
                                name,
                                arguments: JSON.parse(tool._ ?? "{}"),
                            }
                        }
                        try {
                            newResponse.push(await getTool(match));
                        } catch (error) {
                            let toolCall = match;
                            let toolFixMessages: Message[] = [];
                            while (true) {
                                try {
                                    console.log("Error parsing tool call. Attempting to fix:", error);
                                    toolFixMessages.push({
                                        type: "text",
                                        role: "system",
                                        content: `Error parsing tool call ${toolCall}: ${error}. Respond \
with only the corrected XML or 'cancel' to cancel the request. Example: <tool name="get_weather">\
{ "city": "New York" }</tool>`
                                    })
                                    const response = await this._getResponse(this.model, this.messages.concat(toolFixMessages), tools);
                                    toolFixMessages.push(...response);
                                    const message = response[0];
                                    if (message.type != "text") {
                                        throw new Error("Invalid response from LLM");
                                    }
                                    toolCall = message.content;
                                    console.log("Fixed tool call:", toolCall);
                                    if (toolCall.toLowerCase().startsWith("cancel") || !toolCall.trim()) {
                                        console.log("Tool call correction canceled")
                                        break;
                                    }
                                    newResponse.push(await getTool(message.content));
                                    break;
                                } catch(newError) {
                                    error = newError;                                    error = newError;
                                }
                        }
                        }
                    }
                }
                response = newResponse;
            }
            result.push(...response);
            this.messages.push(...response);
            let hasEmptyMessage = false;
            for (const message of response) {
                switch (message.type) {
                    case "text":
                        if (!hasEmptyMessage && !message.content.trim()) {
                            hasEmptyMessage = true;
                            this.messages.push({
                                type: "text",
                                role: "system",
                                content: "Do not respond with an empty message."
                            });
                        };
                        continue;
                    case "tool_call":
                        const toolMessage = await getToolResult(message);
                        result.push(toolMessage);
                        this.messages.push(toolMessage);
                        hasToolResults = true;
                    }
            }
        }
        return result;
    }
}