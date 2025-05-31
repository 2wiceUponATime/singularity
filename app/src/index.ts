import { llm } from "./llm.ts";
import { saveMessages } from "./tools.ts";

while (true) {
    try {
        for (const message of await llm.getResponse()) {
            switch (message.type) {
                case "text":
                    console.log(message.role + ':', message.content);
                    break;
                case "tool_call":
                    console.log(`${message.name}(${JSON.stringify(message.arguments, null, 2)})`);
                    break;
                case "tool":
                    console.log(`${message.name}: ${JSON.stringify(message.result, null, 2)}`);
                    break;
            }
        }
        await saveMessages(llm);
    } catch (error) {
        console.error(error);
        llm.messages.push({
            type: "text",
            role: "system",
            content: "An error occurred. Reverting to previous `reset` state.\n" + error
        });
        await saveMessages(llm);
        process.exit(1);
    }
}