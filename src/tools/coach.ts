import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetHealthSummarySchema, AnalyzeTrendsSchema, Get30DayTrendsSchema } from "../schemas/coach.js";
import type { GetHealthSummaryInput, AnalyzeTrendsInput, Get30DayTrendsInput } from "../schemas/coach.js";
import * as coachService from "../services/coachService.js";
import { ERRORS } from "../utils/errors.js";
import { formatSuccess } from "../utils/formatting.js";
import type { ToolResponse } from "../types.js";

export function registerCoachTools(server: McpServer, userId: string): void {
  server.registerTool(
    "sparky_get_health_summary",
    {
      title: "Get Health Summary",
      description: "Get a summary of the user's health status (Nutrition, Fitness, Vitals, Hydration) for a specific date range.",
      inputSchema: GetHealthSummarySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs): Promise<ToolResponse> => {
      const args = rawArgs as unknown as GetHealthSummaryInput;
      try {
        const result = await coachService.getHealthSummary(userId, args.start_date, args.end_date);
        return formatSuccess(result, "Health Summary");
      } catch (error) {
        console.error("[Coach Tool] getHealthSummary error:", error);
        return ERRORS.DB_ERROR();
      }
    }
  );

  server.registerTool(
    "sparky_analyze_trends",
    {
      title: "Analyze Trends",
      description: "Analyze weight trends vs. calorie intake to identify plateaus or progress over a specified number of days.",
      inputSchema: AnalyzeTrendsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs): Promise<ToolResponse> => {
      const args = rawArgs as unknown as AnalyzeTrendsInput;
      try {
        const result = await coachService.analyzeTrends(userId, args.days);
        return formatSuccess(result, "Trend Analysis");
      } catch (error) {
        console.error("[Coach Tool] analyzeTrends error:", error);
        return ERRORS.DB_ERROR();
      }
    }
  );

  server.registerTool(
    "sparky_get_30_day_trends",
    {
      title: "Get 30-Day Trends",
      description: "Get comprehensive trends for the last 30 days including food, exercise, mood, sleep, and biometrics.",
      inputSchema: Get30DayTrendsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs): Promise<ToolResponse> => {
      const args = rawArgs as unknown as Get30DayTrendsInput;
      try {
        const result = await coachService.get30DayTrends(userId, args.end_date);
        return formatSuccess(result, "30-Day Trends");
      } catch (error) {
        console.error("[Coach Tool] get30DayTrends error:", error);
        return ERRORS.DB_ERROR();
      }
    }
  );
}
