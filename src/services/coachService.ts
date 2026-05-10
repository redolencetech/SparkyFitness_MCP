import { withClient } from "../db/context.js";

function todayDate(): string {
  return new Date().toISOString().split("T")[0];
}

export async function getHealthSummary(
  userId: string,
  startDate: string,
  endDate?: string
): Promise<Record<string, unknown>> {
  const end = endDate || startDate;

  return withClient(userId, async (client) => {
    // Nutrition summary from food_entries
    const nutritionResult = await client.query(
      `SELECT
        COALESCE(SUM(calories), 0)::numeric AS total_calories,
        COALESCE(AVG(protein), 0)::numeric AS avg_protein,
        COALESCE(AVG(carbs), 0)::numeric AS avg_carbs,
        COALESCE(AVG(fat), 0)::numeric AS avg_fat,
        COUNT(*)::int AS entry_count
       FROM food_entries
       WHERE entry_date >= $1 AND entry_date <= $2`,
      [startDate, end]
    );

    // Exercise summary from exercise_entries
    const exerciseResult = await client.query(
      `SELECT
        COALESCE(SUM(calories_burned), 0)::numeric AS total_calories_burned,
        COUNT(*)::int AS workout_count
       FROM exercise_entries
       WHERE entry_date >= $1 AND entry_date <= $2`,
      [startDate, end]
    );

    // Latest weight from check_in_measurements
    const weightResult = await client.query(
      `SELECT weight, entry_date
       FROM check_in_measurements
       WHERE weight IS NOT NULL AND entry_date >= $1 AND entry_date <= $2
       ORDER BY entry_date DESC
       LIMIT 1`,
      [startDate, end]
    );

    // Water intake — column is water_ml (numeric)
    const waterResult = await client.query(
      `SELECT COALESCE(SUM(water_ml), 0)::numeric AS total_water
       FROM water_intake
       WHERE entry_date >= $1 AND entry_date <= $2`,
      [startDate, end]
    );

    const nutrition = nutritionResult.rows[0];
    const exercise = exerciseResult.rows[0];
    const weight = weightResult.rows[0] || null;
    const water = waterResult.rows[0];

    return {
      period: { start_date: startDate, end_date: end },
      nutrition: {
        total_calories: Number(nutrition.total_calories),
        avg_protein: Number(Number(nutrition.avg_protein).toFixed(1)),
        avg_carbs: Number(Number(nutrition.avg_carbs).toFixed(1)),
        avg_fat: Number(Number(nutrition.avg_fat).toFixed(1)),
        entry_count: nutrition.entry_count,
      },
      fitness: {
        total_calories_burned: Number(exercise.total_calories_burned),
        workout_count: exercise.workout_count,
      },
      vitals: {
        latest_weight: weight ? { weight: Number(weight.weight), date: weight.entry_date } : null,
      },
      hydration: {
        total_water_ml: Number(water.total_water),
      },
    };
  });
}

export async function analyzeTrends(
  userId: string,
  days: number
): Promise<Record<string, unknown>> {
  return withClient(userId, async (client) => {
    // Weight entries for the period
    const weightResult = await client.query(
      `SELECT weight, entry_date
       FROM check_in_measurements
       WHERE weight IS NOT NULL AND entry_date >= (CURRENT_DATE - $1::int)
       ORDER BY entry_date ASC`,
      [days]
    );

    // Daily calorie totals
    const calorieResult = await client.query(
      `SELECT entry_date, SUM(calories)::numeric AS daily_calories
       FROM food_entries
       WHERE entry_date >= (CURRENT_DATE - $1::int)
       GROUP BY entry_date
       ORDER BY entry_date ASC`,
      [days]
    );

    const weights = weightResult.rows.map((r: any) => ({
      date: r.entry_date,
      weight: Number(r.weight),
    }));

    const calories = calorieResult.rows.map((r: any) => ({
      date: r.entry_date,
      calories: Number(r.daily_calories),
    }));

    // Calculate weight trend direction
    let weightTrend: "increasing" | "decreasing" | "stable" | "insufficient_data" = "insufficient_data";
    if (weights.length >= 2) {
      const first = weights[0].weight;
      const last = weights[weights.length - 1].weight;
      const diff = last - first;
      if (Math.abs(diff) < 0.5) {
        weightTrend = "stable";
      } else if (diff > 0) {
        weightTrend = "increasing";
      } else {
        weightTrend = "decreasing";
      }
    }

    // Calculate average daily calories
    const avgCalories = calories.length > 0
      ? Number((calories.reduce((sum, c) => sum + c.calories, 0) / calories.length).toFixed(0))
      : 0;

    return {
      period_days: days,
      weight: {
        trend: weightTrend,
        data_points: weights.length,
        entries: weights,
      },
      calories: {
        average_daily: avgCalories,
        data_points: calories.length,
        entries: calories,
      },
    };
  });
}

export async function get30DayTrends(
  userId: string,
  endDate?: string
): Promise<Record<string, unknown>> {
  const end = endDate || todayDate();

  return withClient(userId, async (client) => {
    // Food trends (daily averages)
    const foodResult = await client.query(
      `SELECT
        COUNT(DISTINCT entry_date)::int AS days_logged,
        COALESCE(AVG(daily_cal), 0)::numeric AS avg_daily_calories,
        COALESCE(AVG(daily_protein), 0)::numeric AS avg_daily_protein
       FROM (
         SELECT entry_date, SUM(calories) AS daily_cal, SUM(protein) AS daily_protein
         FROM food_entries
         WHERE entry_date > ($1::date - INTERVAL '30 days') AND entry_date <= $1::date
         GROUP BY entry_date
       ) sub`,
      [end]
    );

    // Exercise trends
    const exerciseResult = await client.query(
      `SELECT
        COUNT(*)::int AS total_workouts,
        COUNT(DISTINCT entry_date)::int AS active_days,
        COALESCE(SUM(calories_burned), 0)::numeric AS total_calories_burned
       FROM exercise_entries
       WHERE entry_date > ($1::date - INTERVAL '30 days') AND entry_date <= $1::date`,
      [end]
    );

    // Mood trends
    const moodResult = await client.query(
      `SELECT
        COUNT(*)::int AS entries,
        COALESCE(AVG(mood_value), 0)::numeric AS avg_mood
       FROM mood_entries
       WHERE entry_date > ($1::date - INTERVAL '30 days') AND entry_date <= $1::date`,
      [end]
    );

    // Sleep trends — column is duration_in_seconds
    const sleepResult = await client.query(
      `SELECT
        COUNT(*)::int AS entries,
        COALESCE(AVG(duration_in_seconds), 0)::numeric AS avg_duration_seconds,
        COALESCE(AVG(sleep_score), 0)::numeric AS avg_sleep_score
       FROM sleep_entries
       WHERE entry_date > ($1::date - INTERVAL '30 days') AND entry_date <= $1::date`,
      [end]
    );

    // Biometric trends (weight)
    const biometricResult = await client.query(
      `SELECT weight, entry_date
       FROM check_in_measurements
       WHERE weight IS NOT NULL AND entry_date > ($1::date - INTERVAL '30 days') AND entry_date <= $1::date
       ORDER BY entry_date ASC`,
      [end]
    );

    const food = foodResult.rows[0];
    const exercise = exerciseResult.rows[0];
    const mood = moodResult.rows[0];
    const sleep = sleepResult.rows[0];
    const weights = biometricResult.rows.map((r: any) => ({
      date: r.entry_date,
      weight: Number(r.weight),
    }));

    return {
      period: { end_date: end, days: 30 },
      food: {
        days_logged: food.days_logged,
        avg_daily_calories: Number(Number(food.avg_daily_calories).toFixed(0)),
        avg_daily_protein: Number(Number(food.avg_daily_protein).toFixed(1)),
      },
      exercise: {
        total_workouts: exercise.total_workouts,
        active_days: exercise.active_days,
        total_calories_burned: Number(exercise.total_calories_burned),
      },
      mood: {
        entries: mood.entries,
        avg_mood: Number(Number(mood.avg_mood).toFixed(1)),
      },
      sleep: {
        entries: sleep.entries,
        avg_duration_hours: Number((Number(sleep.avg_duration_seconds) / 3600).toFixed(1)),
        avg_sleep_score: Number(Number(sleep.avg_sleep_score).toFixed(0)),
      },
      biometrics: {
        weight_entries: weights.length,
        weights,
      },
    };
  });
}
