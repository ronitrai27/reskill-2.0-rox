import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import {
  type InferUITools,
  type ToolSet,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { google } from "@ai-sdk/google";
import {
  getSelectedCareer,
  updateSelectedCareer,
} from "@/lib/functions/dbActions";
import { retrivalServer } from "@/lib/functions/pineconeQuery";
import { tavily } from "@tavily/core";

const tvly = tavily({
  apiKey: process.env.NEXT_PUBLIC_TAVILY_API_KEY!,
});

const localTools = {
  tavilySearch: tool({
    description:
      "Search the web in real-time for up-to-date information using Tavily API. Use this when the query requires fresh accurate data/facts or external knowledge not present in Pinecone.",
    parameters: z.object({
      query: z.string().describe("The search query to look up on the web"),
    }),
    // @ts-ignore
    execute: async ({ query }: { query: string }) => {
      try {
        const res = await tvly.search(query, {
          search_depth: "basic",
          max_results: 3,
        });

        const results = (res.results || [])
          .slice(0, 3)
          .map(
            (r: any, i: number) =>
              `#${i + 1} ${r.title}\n${r.content?.slice(0, 300)}\nSource: ${r.url}`,
          )
          .join("\n\n");

        return `Top Results:\n${results}`.slice(0, 2000);
      } catch (err) {
        console.error("Tavily API error:", err);
        return "Error fetching Tavily data.";
      }
    },
  }),
  // retrival: tool({
  //   description:
  //     "Retrieve relevant information from Pinecone vector database based on user query. Useful when additional context or knowledge is required before answering.",
  //   parameters: z.object({
  //     userQuery: z
  //       .string()
  //       .describe("The user's natural language query to search in Pinecone"),
  //   }),
  //   // @ts-ignore
  //   execute: async ({ userQuery }: { userQuery: string }) => {
  //     try {
  //       const result = await retrivalServer(userQuery);
  //       return result;
  //     } catch (err) {
  //       console.error("Error in retrival tool:", err);
  //       return "Failed to retrieve information.";
  //     }
  //   },
  // }),
  updateCareerTool: tool({
    description:
      "Update the selected career of a specific user in the userQuizData table. Use this when modifying an existing record or when user selects a new career.",
    parameters: z.object({
      userId: z.string().describe("The user ID to update the career for"),
      career: z
        .string()
        .describe(
          "The new career choice that user wants.",
        ),
    }),
    // @ts-ignore
    execute: async ({
      userId,
      career,
    }: {
      userId: string;
      career: string;
    }) => {
      try {
        console.log("userId passed by AI:", userId);
        console.log("career passed by AI:", career);
        // Fallback for AI hallucination of key names
        const careerValue = career; 
        const result = await updateSelectedCareer(userId, careerValue);
        return result;
      } catch (error) {
        console.error("Error in updateCareerTool:", error);
        return null;
      }
    },
  }),
} satisfies ToolSet;

export type ChatTools = InferUITools<typeof localTools>;

export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>;

export async function POST(req: Request) {
  try {
    const {
      messages,
      userId,
      userName,
      user_current_status,
      careerOptions,
      summary,
      stream,
    } = await req.json();
    console.log("Message received API/AGENT/CHAT: --------->", {
      userId,
      userName,
      user_current_status,
      careerOptions,
      summary,
      stream,
    });

    const systemPrompt = `
You are a highly professional and empathetic AI Career Coach whose sole focus is to help ${userName} in choosing right career path and update it using the tool. 
${userName} is currently a ${user_current_status} in ${stream || "N/A"}. Based on their quiz results — suggested career options: ${careerOptions}, and summary: ${summary} — your goal is to update their desired career using the tools below for real-time updates and information and help them make informed choices and choose the career that they want to have.

User Information:
- User ID: ${userId}
- User Name: ${userName}
- Current Status: ${user_current_status}
- Career Options: ${careerOptions}
- Quiz Summary: ${summary}

Your Main goal using tool is:
1. Update user's career choice in the database using tools provided. (You MUST use the userId: ${userId} for getCareerTool and updateCareerTool)
--ALways remember to update user career you need userId and career choice of the user.
-- detect the career user wants to pass it to updateCareerTool. along with userId.

For accurate and personalized guidance, you can use two knowledge tools freely:
(b) Search the web in real time using Tavily.
`;

    const result = streamText({
      model: google("gemini-3-flash-preview"),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: localTools,
      toolChoice: "auto",
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      sendSources: true,
    });
  } catch (error) {
    console.error("Error in chat route:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
