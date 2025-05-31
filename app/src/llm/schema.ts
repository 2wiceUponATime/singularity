import { JSONSchema } from "openai/lib/jsonschema";

type Primitives = {
    string: string,
    number: number,
    integer: number,
    boolean: boolean,
    null: null,
}
type PrimitiveName = keyof Primitives;
type Primitive = Primitives[PrimitiveName];
export interface Schema<_> extends JSONSchema {};
export type Type<T> = T extends Schema<infer U> ? U : never;

function primitive<T extends Primitive>(type: PrimitiveName) {
    return (description?: string): Schema<T> => {
        const result: JSONSchema = { type };
        if (description) result.description = description;
        return result;
    }
}

const s = {
    string:  primitive<string>("string"),
    number:  primitive<number>("number"),
    integer: primitive<number>("integer"),
    boolean: primitive<boolean>("boolean"),
    null:    primitive<null>("null"),
    primitives<T extends PrimitiveName[]>(types: T, description?: string): Schema<{ [K in keyof T]: Primitives[T[K]] }[number]> {
        const result: JSONSchema = {
            type: types,
        }
        if (description) result.description = description;
        return result as Schema<unknown>;
    },
    object<T extends Record<string, Schema<unknown>>>(properties: T, description?: string): Schema<{
        [K in keyof T]: Type<T[K]>;
    }> {
        const result: JSONSchema = {
            type: "object",
            properties,
            required: Object.keys(properties),
            additionalProperties: false,
        };
        if (description) result.description = description;
        return result;
    },
    list<T>(items: Schema<T>, description?: string): Schema<T[]> {
        const result: JSONSchema = {
            type: "array",
            items: items,
        };
        if (description) result.description = description;
        return result as Schema<unknown>;
    },
    union<T extends readonly Schema<unknown>[]>(types: [...T], description?: string): Schema<Type<T[number]>> {
        const result: JSONSchema = {
            oneOf: types,
        };
        if (description) result.description = description;
        return result as Schema<Type<T[number]>>;
    }
};

export { s };