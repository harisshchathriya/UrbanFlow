export type EarningsInput = {
  distanceKm: number;
  deliveredAt: string | null;
};

export type EarningsSummary = {
  dailyTotal: number;
  weeklyTotal: number;
  averagePerDelivery: number;
  entries: Array<{
    deliveryId: string;
    distanceKm: number;
    earning: number;
    deliveredAt: string | null;
  }>;
};

export type CompletedDeliveryForEarnings = {
  id: string;
  delivered_at: string | null;
  route_distance_km: number | null;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const calculateDeliveryEarning = (distanceKm: number, ratePerKm: number): number => {
  return roundMoney(Math.max(distanceKm, 0) * ratePerKm);
};

export const buildEarningsSummary = (
  completedDeliveries: CompletedDeliveryForEarnings[],
  ratePerKm: number,
  nowDate = new Date()
): EarningsSummary => {
  const now = new Date(nowDate);
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);

  let dailyTotal = 0;
  let weeklyTotal = 0;

  const entries = completedDeliveries.map((delivery) => {
    const distanceKm = Math.max(delivery.route_distance_km ?? 0, 0);
    const earning = calculateDeliveryEarning(distanceKm, ratePerKm);
    const deliveredDate = delivery.delivered_at ? new Date(delivery.delivered_at) : null;

    if (deliveredDate && isSameDay(deliveredDate, now)) {
      dailyTotal += earning;
    }
    if (deliveredDate && deliveredDate >= weekAgo && deliveredDate <= now) {
      weeklyTotal += earning;
    }

    return {
      deliveryId: delivery.id,
      distanceKm,
      earning,
      deliveredAt: delivery.delivered_at,
    };
  });

  const averagePerDelivery =
    entries.length > 0 ? roundMoney(entries.reduce((sum, e) => sum + e.earning, 0) / entries.length) : 0;

  return {
    dailyTotal: roundMoney(dailyTotal),
    weeklyTotal: roundMoney(weeklyTotal),
    averagePerDelivery,
    entries,
  };
};
