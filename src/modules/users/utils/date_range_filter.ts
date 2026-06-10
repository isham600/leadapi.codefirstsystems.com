export type PeriodType =
  | "last_24_hours"
  | "today"
  | "yesterday"
  | "daily"
  | "last_7_days"
  | "last_30_days"
  | "monthly"
  | "custom";

export const getDateRange = (
  period: PeriodType = "last_7_days",
  from?: string,
  to?: string
) => {
  const now = new Date();

  let startDate: Date;
  let endDate: Date;

  switch (period) {
    case "last_24_hours": {
      endDate = new Date(now);
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    }

    case "today": {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "yesterday": {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setDate(now.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "daily": {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "last_7_days": {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "last_30_days": {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "monthly": {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case "custom": {
      if (!from || !to) {
        throw new Error("From and To dates are required for custom range");
      }

      startDate = new Date(from);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    default: {
      // fallback → last 7 days
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }
  }

  return {
    startDate,
    endDate,
  };
};