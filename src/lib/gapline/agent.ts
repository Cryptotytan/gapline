import { createServerFn } from "@tanstack/react-start";

export const askAgent = createServerFn({ method: "POST" })
  .validator((input: { sentence: string; tape: string }) => {
    if (!input || typeof input.sentence !== "string" || typeof input.tape !== "string") {
      throw new Error("Write a sentence first.");
    }
    return { sentence: input.sentence.slice(0, 400), tape: input.tape.slice(0, 1200) };
  })
  .handler(async ({ data }) => {
    const { interpretRule } = await import("./agent.server");
    return interpretRule(data.sentence, data.tape);
  });
