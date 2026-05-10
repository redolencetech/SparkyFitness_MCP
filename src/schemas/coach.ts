import { z } from "zod";
import { dateSchema, optionalDateSchema } from "./common.js";

export const GetHealthSummarySchema = z.object({
  start_date: dateSchema,
  end_date: optionalDateSchema,
}).strict();

export const AnalyzeTrendsSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7).describe("Number of days to analyze (1-90)"),
}).strict();

export const Get30DayTrendsSchema = z.object({
  end_date: optionalDateSchema,
}).strict();

export type GetHealthSummaryInput = z.infer<typeof GetHealthSummarySchema>;
export type AnalyzeTrendsInput = z.infer<typeof AnalyzeTrendsSchema>;
export type Get30DayTrendsInput = z.infer<typeof Get30DayTrendsSchema>;
